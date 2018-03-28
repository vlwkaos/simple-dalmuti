var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);

var port = process.env.PORT || 8080;
app.use(express.static(__dirname + '/src'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/src/index.html');
})

app.get('/help',(req,res)=>{
    res.sendFile(__dirname + '/src/help.html');
})

/////////////////////////////////////
/// Server Variables
/////////////////////////////////////
var roomNumber=0
var connectNumber=1;
var user_count = 0;
/////////////////////////////////////
/// key = # num roomname
/// remember to update orderly then send
///
/////////////////////////////////////
io.on('connection', (socket)=> {
    user_count++
    socket.userData = new Player('Guest'+connectNumber, 'waiting room') // Higher-Level game related Data of socket
    connectNumber++
     // give update to a client only
    socket.join('waiting room')
    io.to('waiting room').emit('refresh waiting room', socket.userData, getCustomRooms(socket), user_count)
    console.log(socket.userData.nickname+' joined waiting room')

    /////////////////////////////////////
    /// Player settings
    /////////////////////////////////////
    socket.on('init', ()=>{
        socket.emit('update sender', socket.userData)
    })

    socket.on('set new nickname', (n_nickname)=>{
        console.log('nickname change from '+socket.userData.nickname+' to '+n_nickname)
        socket.userData.nickname = n_nickname
        socket.emit('update sender', socket.userData)
    })


    /////////////////////////////////////
    /// Server thing
    /////////////////////////////////////
    //Create Room
    socket.on('create game room', (room_name) => {
        roomNumber++
        joinRoom(socket,'#'+roomNumber+' '+room_name) // redefine room name for server
    })

    //Room is identified by number+name
    socket.on('join game room',(room_name)=>{
        joinRoom(socket,room_name)
    })

    socket.on('chat message', (msg)=>{
        io.to(socket.userData.cur_room).emit('chat message', socket.userData.nickname, msg)
    })

    socket.on('ready', ()=>{
        let room_name = socket.userData.cur_room

        // can only ready during waiting
        if (socket.adapter.rooms[room_name].game.state == game_state.WAITING && !socket.userData.ready) {
            socket.userData.ready = true;
            socket.adapter.rooms[room_name].game.readyCount++
            syncUserToRoom(socket)

            // send out updated data
            io.to(room_name).emit('refresh game room', socket.adapter.rooms[room_name])

            // check game state, is it WAITING? more than 2 ready?
            // Shared data, so use roomData not userData 
            if (socket.adapter.rooms[room_name].length >=2 && socket.adapter.rooms[room_name].game.readyCount==socket.adapter.rooms[room_name].length){

                //start game
                console.log(room_name+": game started")
                io.to(room_name).emit('chat announce', 'The game has started.','blue')
                // set order, shuffle, etc.
                socket.adapter.rooms[room_name].game.start(socket.adapter.rooms[room_name])
                
                // distribute
                console.log(socket.adapter.rooms[room_name])
                let handlim = Math.floor(80/socket.adapter.rooms[room_name].length)
                let cnt = 0
                for (const [sid, user] of Object.entries(socket.adapter.rooms[room_name].sockets)){
                    
                    for (let i=cnt*handlim;i<handlim*cnt+handlim; i++){
                        user.hand.push(socket.adapter.rooms[room_name].game.deck[i]) // userData and room user Data not in sync
                    }
                    cnt++
                }

                io.to('waiting room').emit('refresh waiting room', socket.userData, getCustomRooms(socket), user_count) // notify start
                io.to(room_name).emit('refresh game room', socket.adapter.rooms[room_name])
            }
        }


    })

    socket.on('play', (selected_card)=>{




        let room_name = socket.userData.cur_room

        // but first of all, is it playing?
        if (socket.adapter.rooms[room_name].game.state != game_state.PLAYING){
            socket.emit('alert', 'This should not happen.')
            return
        }

        if (checkOrder(socket, socket.adapter.rooms[room_name])){

            // delete 0 cards, this won't happen unless someone messed with client code
            for (const [card, val] of Object.entries(selected_card)){
                if (val == 0)
                    delete selected_card[card]
                console.log('checking, how deleting in loop affects iterating')    
            }
            console.log(selected_card)

            // check PASS
            if (Object.keys(selected_card).length == 0){
                // 0 card submitted
                let tmp_idx = socket.adapter.rooms[room_name].game.cur_order_idx //현재 순서
                socket.adapter.rooms[room_name].game.cur_order[tmp_idx] = 0 // pass

                // if this is last pass, erase last hand give prior to last player who played
                // also renew cur_order for next round
                // and update last hand. Last hand will be used to display cards on field
                socket.adapter.rooms[room_name].game.nextPlayer(selected_card)

                io.to(room_name).emit('refresh game room', socket.adapter.rooms[room_name])

            } else
            if (checkValidity(socket, socket.adapter.rooms[room_name], selected_card)){
                if (checkRule(socket.adapter.rooms[room_name], selected_card)){
                    // Everything seems fine. 
                    
                    // update hand
                    updateHand(socket, socket.adapter.rooms[room_name], selected_card)
                    
                    //
                    if (socket.adapter.rooms[room_name].sockets[socket.id].hand.length == 0){
                        // win due to empty hand
                        socket.adapter.rooms[room_name].game.updateOrder(socket.userData.seat,room_name)
                        io.to(room_name).emit('chat announce', socket.userData.nickname+' has won!!!', 'green')

                        if (socket.adapter.rooms[room_name].game.isOneLeft()){
                            io.to(room_name).emit('chat announce', 'The game has ended due to only one player remaining.', 'red')
                            //end game
                            socket.adapter.rooms[room_name].game.end()
                            for (const [sid,userData] of Object.entries(socket.adapter.rooms[room_name].sockets)) {
                                userData.reset()
                            }
                        }

                    } 
                        
                    
                    socket.adapter.rooms[room_name].game.nextPlayer(selected_card)
                    // refresh
                    io.to(room_name).emit('refresh game room', socket.adapter.rooms[room_name])

                } else {
                    // nope
                    socket.emit('alert', 'Please choose the right cards.')
                }

            } else {
                socket.emit('alert', 'This should not happen.')
            }
        }// check order 
        else {
            socket.emit('alert', 'Please wait for your turn.')
        }
    })

    socket.on('disconnect', () => {
        user_count--
        console.log(socket.userData.nickname+' disconnected from server');

        updateRoomDisconnect(socket, socket.userData.cur_room)
        
        io.to('waiting room').emit('refresh waiting room', socket.userData, getCustomRooms(socket), user_count)
        //We want to avoid user from disconnecting during game
        //so if this happens its 'all disconnect'. no leaving during the game
        // redistribute

    });

    //Game, broadcast only to same room



});

http.listen(port, () => {
    console.log('listening on *:' + port);
});

/////////////////////////////////////
/// Utility
/////////////////////////////////////


function syncUserToRoom(socket){
    if (socket.userData.cur_room!= 'waiting room' && socket.adapter.rooms[socket.userData.cur_room])
        socket.adapter.rooms[socket.userData.cur_room].sockets[socket.id] = socket.userData
}


function getCustomRooms(socket){
    let tempRooms = {}
    for (const [key, value] of Object.entries(socket.adapter.rooms)){
        if (key.charAt(0)==='#')
            tempRooms[key] = value;
    }
    // console.log(tempRooms)
    return tempRooms
}

// called upon leaving room or disconnection
function updateRoomDisconnect(socket,room_name){

    socket.leave(room_name)
    socket.join('waiting room')

    // update room
    if (socket.adapter.rooms[room_name]){
        socket.adapter.rooms[room_name].seats[socket.userData.seat]=false
        // undo ready if left with 'ready' before the game start
        if (socket.userData.ready)
            socket.adapter.rooms[room_name].game.readyCount--    

        // user left during the game
        // omit from order list
        if (socket.adapter.rooms[room_name].game.state == game_state.PLAYING){
            socket.adapter.rooms[room_name].game.updateOrder(socket.userData.seat,room_name)


            if (socket.adapter.rooms[room_name].game.isOneLeft()){
                io.to(room_name).emit('chat announce', 'The game has ended due to only one player remaining.', 'red')
                //end game
                socket.adapter.rooms[room_name].game.end()
                for (const [sid,userData] of Object.entries(socket.adapter.rooms[room_name].sockets)) {
                    userData.reset()
                }
                //
            }

            // pass or evaluate or refresh during game...? pass turn?
            if (socket.adapter.rooms[room_name].game.cur_order_idx == socket.userData.seat){
                // pass turn
                socket.adapter.rooms[room_name].game.nextPlayer({})
            }
            // 아무튼 그래야 자기 턴인 애가 나갔을 때, 아닌애가 나갔을 때
            io.to(room_name).emit('refresh game room', socket.adapter.rooms[room_name])
        }    
    }



    // update/reset user
    socket.userData.reset()
    socket.userData.leaveRoom()

    io.to(room_name).emit('refresh game room',  socket.adapter.rooms[room_name])
    io.to(room_name).emit('chat connection', socket.userData)
}
/////////////////////////////////////
/// Action
/// string property only works with [] 
/////////////////////////////////////

function joinRoom(socket,room_name){
    // seat vacancy check
    socket.leave('waiting room')
    socket.join(room_name)
    console.log(socket.userData.nickname+' joined '+room_name)
    

    //integrity update
    if (!socket.adapter.rooms[room_name].seats){
        socket.adapter.rooms[room_name].seats = new Array(8).fill(false);
    }
    for (let i=0;i<8;i++){
        if (!socket.adapter.rooms[room_name].seats[i]){ // is vacant
            socket.adapter.rooms[room_name].seats[i]=true
            socket.userData.seat = i
            break;
        }
    }
    if (socket.userData.seat == -1){
        //room is full. failed to join 
        //TODO full emit
        console.log('room full')
        socket.leave(room_name)
        socket.join('waiting room')
        socket.emit('refresh waiting room', socket.userData, getCustomRooms(socket), user_count)
        socket.emit('alert', 'Room is full')
        return
    }

    // if there is no game object, give one
    if (!socket.adapter.rooms[room_name].game)
        socket.adapter.rooms[room_name].game = new Game()

    //update user
    socket.userData.cur_room = room_name
    //update room data
    syncUserToRoom(socket)

    
    //refresh list
    io.to('waiting room').emit('refresh waiting room', socket.userData, getCustomRooms(socket), user_count)
    io.to(room_name).emit('refresh game room',  socket.adapter.rooms[room_name]) // send info about room
    io.to(room_name).emit('chat connection', socket.userData)

    socket.emit('update sender', socket.userData)
}

function checkOrder(socket, roomData){
    if (socket.userData.seat != roomData.sockets[socket.id].seat) // correctly in the room?
        return false // illegal behavior detected

    if (roomData.game.cur_order_idx!=socket.userData.seat) // check turn
        return false // illegal behavior detected

    return true
}

// check if selected cards are actually in hand
function checkValidity(socket, roomData, selected_card){

    let sid = socket.id
    let hand_map = {}
    for (let i=0;i < roomData.sockets[sid].hand.length;i++){
        let card = roomData.sockets[sid].hand[i]
        if (!hand_map[card])
            hand_map[card] = 0
        hand_map[card]++
    }

    for (const [card, count] of Object.entries(selected_card)){
        if (!hand_map[card]) // selected card is not available in hand: illegal
            return false
        else{
            //if there is, count should be equal to or less
            if (count > hand_map[card])
                return false // more is selected than what a user has: illega
        }
    }

    return true
}


function checkRule(roomData, selected_card){

    let count = 0
    for (const [card, val] of Object.entries(selected_card)){
        count+=val
    }

     // no more than two types of cards
    if (Object.keys(selected_card).length > 2)
        return false // if there are, illegal
    else if (Object.keys(selected_card).length == 2 && !selected_card[13])// if there are two types of cards, one of them must be 13
        return false //else illegal


    // last is merged as {num: no, count: count}
    if (roomData.game.last){
        // card count should be the same
        if (roomData.game.last.count != count)
            return false // else illegal

        

        //single card type which is normal, then 13 has no power
        if (Object.keys(selected_card).length == 1) {
            for (const [card, val] of Object.entries(selected_card)){
                if (roomData.game.last.num - card <= 0) { // can't throw 13 alone
                    console.log(roomData.game.last.num+' <= '+card)
                    return false // if any of card no. is equal/greater than the last one, no go
                }
            }
        } else { // more than 1 card type
            console.log('13 included')
            // case with with 13
            // except 13, the card no. must be smaller
            for (const [card, val] of Object.entries(selected_card)){
                if (card != 13 && roomData.game.last.num - card <= 0) {
                    return false // if any of card no. is equal/greater than the last one, no go
                }
            }
        }

        // if everything checks, then good to go
        return true
    } else { // there is no previous play, or deleted due to winning a round
        return true
    }
}

function updateHand(socket, roomData, selected_card){
    let sid =socket.id
    let room_name = socket.userData.cur_room
    let hand_map = {}
    for (let i=0;i < roomData.sockets[sid].hand.length;i++){
        let card = roomData.sockets[sid].hand[i]
        if (!hand_map[card])
            hand_map[card] = 0
        hand_map[card]++
    }


    for (const [card, count] of Object.entries(selected_card)){
        hand_map[card]-=count
    }
    // map to list
    let new_hand = []
    for (const [card, count] of Object.entries(hand_map)){
        let m = count
        while (m-- > 0) new_hand.push(card)
    }
    roomData.sockets[sid].hand = new_hand

    // if your hand is empty? you win
}

/////////////////////////////////////
/// Objects
/// no encapulation
/////////////////////////////////////
/// Room - sockets(clients) : map of userData
///      - length
///      - game : Game data


class Player {
    
    constructor(nickname,sid, cur_room){
        this.nickname = nickname
        this.cur_room = cur_room
        this.seat = -1 // = order
        this.ready = false
        this.hand = []

    }

    reset(){
        this.hand = []
        this.ready = false
    }

    leaveRoom(){
        this.seat = -1
        this.cur_room = 'waiting room'
    }
}

var game_state = {
    WAITING: 0,
    PLAYING: 1,
};

class Game{
    constructor(){
        this.state = game_state.WAITING
        this.readyCount = 0
        this.deck = this.prepareDeck()
        this.cur_order_idx = -1
    }

    //
    updateOrder(omit_i){
        this.order[omit_i] = false
        this.cur_order[omit_i] = -1
    }

    start(roomData){
        this.state = game_state.PLAYING

        // order: order for the whole game
        // cur_order: currunt round order (in case of passes)
        this.order = new Array(8).fill(false)
        this.cur_order = new Array(8).fill(-1)
        // get ready  
        for (const [sid,userData] of Object.entries(roomData.sockets)) {
            if (userData.ready){
                this.order[userData.seat] = true
            }
        }

        // set cur order
        // -1 not in game
        // 0 pass
        // 1 in game
        for (let i=0;i<this.order.length;i++){
            if (this.order[i]) 
                this.cur_order[i] = 1
            else
                this.cur_order[i] = -1
        }

        this.cur_order_idx = Math.floor(Math.random() * 8)
        while (this.cur_order[this.cur_order_idx] < 1)
            this.cur_order_idx = Math.floor(Math.random() * 8) // cursor

        // shuffle deck
        this.deck = this.shuffle(this.deck)

    }

    end(){
        this.state = game_state.WAITING
        this.readyCount = 0
        delete this.order
        delete this.cur_order
        delete this.last
    }

    nextRound(){
        // renwe cur_order
        for (let i=0;i<this.order.length;i++){
            if (this.order[i]) 
                this.cur_order[i] = 1
            else
                this.cur_order[i] = -1
        }

        delete this.last
    }

    nextPlayer(selected_card){
        if (!this.cur_order)
            return
        console.log(this.cur_order_idx)
        this.cur_order_idx = (this.cur_order_idx+1) % this.cur_order.length
        while (this.cur_order[this.cur_order_idx] < 1)
            this.cur_order_idx = (this.cur_order_idx+1) % this.cur_order.length
        // if not playable increment until it is
        
        // update last hand(field) if not pass
        if (Object.keys(selected_card).length > 0){
            this.last = selected_card
            let count = 0
            for (const [card, val] of Object.entries(this.last)){
                if (card != 13)
                    this.last.num = card
                count+=val
            }
            this.last.count = count
        }

        // if it comes to the same user, the round finishes         
        let still_playing = 0
        for (let i=0;i<this.cur_order.length;i++){
            if (this.cur_order[i] == 1)
                still_playing++ // count playable user
        }

        if (still_playing == 1){ // only one
            this.nextRound()
        }
    }

    isOneLeft(){
        let cnt = 0
        for (let i=0;i<this.order.length;i++)
            if (this.order[i])
                cnt++

        return cnt <= 1
    }

    /////////////////////////////////////
    shuffle(array) {
        let counter = array.length;

        // While there are elements in the array
        while (counter > 0) {
            // Pick a random index
            let index = Math.floor(Math.random() * counter);

            // Decrease counter by 1
            counter--;

            // And swap the last element with it
            let temp = array[counter];
            array[counter] = array[index];
            array[index] = temp;
        }

        return array;
    }

    prepareDeck(){
        let deck = new Array(80)
        let i = 0
        for (let card = 12; card>=1; card--){
            for (let cnt = card; cnt>=1; cnt--){
                deck[i] = card
                i++
            }            
        }
        deck[i++]=13
        deck[i] = 13

        return deck
    }

}
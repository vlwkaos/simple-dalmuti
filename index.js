var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);

var port = process.env.PORT || 8080;
app.use(express.static(__dirname + '/src'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/src/index.html');
});

/////////////////////////////////////
/// Server Variables
/////////////////////////////////////
var roomNumber=0
var connectNumber=1;
/////////////////////////////////////
/// key = # num roomname
/// remember to update orderly then send
///
/////////////////////////////////////
io.on('connection', (socket)=> {
    socket.userData = new Player('Guest'+connectNumber, 'waiting room') // Higher-Level game related Data of socket
    connectNumber++
     // give update to a client only
    socket.join('waiting room')
    io.to('waiting room').emit('refresh waiting room', socket.userData, getCustomRooms(socket))
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
            // For all, so use roomData 
            if (socket.adapter.rooms[room_name].length >=2 && socket.adapter.rooms[room_name].game.readyCount==socket.adapter.rooms[room_name].length){
                //start game
                console.log(room_name+": game started")
                
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
                    console.log(user)
                }


                io.to(room_name).emit('game start', socket.adapter.rooms[room_name])
            }
        }


    })



    socket.on('disconnect', () => {
        console.log(socket.userData.nickname+' disconnected from server');

        updateRoomDisconnect(socket, socket.userData.cur_room)

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
            let tmp = socket.adapter.rooms[room_name].game.order.indexOf(socket.userData.seat)
            socket.adapter.rooms[room_name].game.updateOrder(tmp)

            // pass or evaluate or refresh during game...? pass turn?
            if (socket.adapter.rooms[room_name].game.cur_order_idx == socket.userData.seat){
                // pass turn
            }
            // 아무튼 그래야 자기 턴인 애가 나갔을 때, 아닌애가 나갔을 때
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
    io.to('waiting room').emit('refresh waiting room', socket.userData, getCustomRooms(socket))
    io.to(room_name).emit('refresh game room',  socket.adapter.rooms[room_name]) // send info about room
    io.to(room_name).emit('chat connection', socket.userData)

    socket.emit('update sender', socket.userData)
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
        this.cur_order_idx = 0
    }

    updateOrder(omit_i){
        let tmp_order = []
        for (let i=0;i<this.order.length;i++){
            if (i!=omit_i)
                tmp_order.push(this.order[i])
        }
        this.order = tmp_order

    }

    start(roomData){
        this.state = game_state.PLAYING

        // Set Order 
        this.order = new Array(this.readyCount)
        for (let i=0;i<this.order.length;i++){
            this.order[i]=i
        }
        this.order = this.shuffle(this.order)
        
        // shuffle deck
        this.deck = this.shuffle(this.deck)

        //distribute, outside

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
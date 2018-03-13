/////////////////////////////////////
// Entry
/////////////////////////////////////
var game_state = {
    WAITING: 0,
    PLAYING: 1,
};

var socket = io()

$(function() {

	/////////////////////////////////////

	socket.emit('init') // for sender-only update

/////////////////////////////////////
// Click Handlers
/////////////////////////////////////
    $('#form-create-room').submit(()=>{

    	//empty chat log
    	$('#chat-messages').empty()
    	showLoadingText()
    	socket.emit('create game room', $('#new-room-name').val())
    	$('#new-room-name').val('');

    	return false
    })

    $('#form-set-nickname').submit(()=>{
    	socket.emit('set new nickname', $('#set-nickname').val())
    	$('.nickname').text($('#set-nickname').val()) // client change
    	$('#set-nickname').val('');
    	return false
    })


    $('#form-chatting').submit(()=>{
    	$('#message-input').val('');
    	return false
    })


    // button, must be checked on server side
    $('#ready-btn').on('click',()=>{
    	socket.emit('ready')
    })



    // pass turn, next order
});


/////////////////////////////////////
//	Personal Update
/////////////////////////////////////
socket.on('update sender', (user)=>{
	$('.nickname').text(user.nickname)
	$('#room-title').text(user.cur_room)
})


/////////////////////////////////////
// Public(Shared) Update
/////////////////////////////////////
// Enter waiting Room
socket.on('refresh waiting room',(user, rooms)=>{
	$('#hand').empty()
	//transition to waiting room screen
	$('#game-room').hide()
	$('#waiting-room').show()//TODO add room list

	//refresh list
	let roomCount=0;
	$('#room-list').empty()

	for (const [key, room] of Object.entries(rooms)) {
		appendGameRoom(key,room.length)
		roomCount++
	}
	$('#room-list').append('<li class="w3-half w3-border" onclick="document.getElementById(\'id01\').style.display=\'block\'">Create New Room</li>')
	$('#title').text('DalmutiOnline('+roomCount+' Rooms)')
})

//Enter Game Room
//Need Room specific data updated
socket.on('refresh game room', (roomData)=>{
	if (roomData.game.state==game_state.WAITING){
		$('#ready-btn').removeClass('w3-disabled')

		//다른 애들만 TODO
		$('#play-btn').addClass('w3-disabled')
		$('#pass-btn').addClass('w3-disabled')
	} else { // start
		$('#ready-btn').addClass('w3-disabled')
	}


	$('#waiting-room').hide()
	$('#game-room').show()	

	//listed on fiel
	reloadSlots(roomData)
})

/////////////////////////////////////
// Game start
// 어쩌면 위에거랑 합칠 수도
/////////////////////////////////////

socket.on('game start', (roomData)=>{
	$('#ready-btn').addClass('w3-disabled')


	console.log(roomData)
	// list shared info
	reloadSlots(roomData)

	// show cards
	reloadCards(socket.id ,roomData)

	// enable first player
	setPlayable(roomData)


})


socket.on('chat connection',(user)=>{
	
	//connected to chat
	if (user.seat > -1)
		$('#chat-messages').append($('<li>').text(user.nickname+' connected'));
	else
		$('#chat-messages').append($('<li>').text(user.nickname+' disconnected'));
})


/////////////////////////////////////
//
/////////////////////////////////////
function setPlayable(roomData){
	// check who?
	let cur = roomData.game.order[roomData.game.cur_order_idx]
	$('#player'+cur).addClass('w3-border-green w3-bottombar')

	for (const [sid, userData] of Object.entries(roomData.sockets)){
		console.log(userData.seat)
		if (cur == userData.seat && sid == socket.id){
			$('#play-btn').removeClass('w3-disabled')
			$('#pass-btn').removeClass('w3-disabled')
		} else {
			$('#play-btn').addClass('w3-disabled')
			$('#pass-btn').addClass('w3-disabled')
		}
	}
}


function appendGameRoom(name, length){
	let $newli = $("<li class='w3-half w3-border game-room'><b>"+name+" - "+length+"/8</li>")
	$newli.on('click',()=>{
		//join room
		showLoadingText()
		socket.emit('join game room', name)
		
	})
	$('#room-list').append($newli);
}

function showLoadingText(){
	//waiting room
	$('#title').text('Connecting... Please Wait')
	$('#room-list').empty()
}

function reloadSlots(roomData){
	for (let i=0;i<8;i++){
		$('#player'+i).empty()
	}
	for (const [sid, user] of Object.entries(roomData.sockets)){
		$('#player'+user.seat).append($('<p><b>'+user.nickname+'</b></p>'))
		$('#player'+user.seat).append($('<p>'+user.hand.length+'</p>'))

		if (roomData.game.state==game_state.WAITING){
			if (user.ready)
				$('#player'+user.seat).append($('<p>READY</p>'))
			else
				$('#player'+user.seat).append($('<p>NOT READY</p>'))
		} else {
			if (user.ready)
				$('#player'+user.seat).append($('<p>PLAYING</p>'))
			else
				$('#player'+user.seat).append($('<p>SPECTATOR</p>'))
		}
	}

}

function reloadCards(sid, roomData){
	let card_colors = ['red','purple','indigo','light-blue','aqua','green','lime','khaki','amber','deep-orange','brown','gray','pink']
	// card -1
	let userData = roomData.sockets[sid]

	userData.hand.sort(function(a, b) {
 		 return a - b;
	});
	let actual_card_count = 1

	for (let i=0;i<userData.hand.length;i++){
		if (userData.hand[i] != -1){
			let $carddiv = $("<div class='w3-btn w3-border w3-border-black w3-display-container w3-"+card_colors[userData.hand[i]-1]+"' style='width: 69px; height:10vh; position:absolute; left: calc(100% * "+actual_card_count+" / "+userData.hand.length+
								"); top: 2vh'><div class='w3-display-topleft'>"+userData.hand[i]+"</div><div class='w3-display-bottomright'>"+userData.hand[i]+"</div></div>")
			$carddiv.on('click',()=>{

			})


			$('#hand').append($carddiv)
			actual_card_count++
		}
	}
}
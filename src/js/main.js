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
    	socket.emit('chat message', $('#message-input').val())
    	
    	$('#message-input').val('');
    	return false
    })


    // button, must be checked on server side
    $('#ready-btn').on('click',()=>{
    	socket.emit('ready')
    })

    // pass turn, next order
    $('#play-btn').on('click',()=>{
    	$('#play-btn').addClass('w3-disabled')

    	socket.emit('play', selected_card)
    })
});


/////////////////////////////////////
//	Personal Update
/////////////////////////////////////
socket.on('update sender', (user)=>{
	$('.nickname').text(user.nickname)
	$('#room-title').text(user.cur_room)
})

socket.on('alert', (msg)=>{
	$('#play-btn').removeClass('w3-disabled')
	alert_big(msg)
})

function alert_big(msg){
	$('#error-msg-bg').show()
	$('#error-msg').text(' '+msg+' ')
	setTimeout(()=>{ $('#error-msg-bg').hide()}, 3000);
}
/////////////////////////////////////
// Public(Shared) Update
/////////////////////////////////////
// Enter waiting Room
socket.on('refresh waiting room',(user, rooms, user_count)=>{
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
	$('#title').text('DalmutiOnline('+roomCount+' rooms / '+user_count+' users online)')
})

//Enter Game Room
//Need Room specific data updated
socket.on('refresh game room', (roomData)=>{
	if (roomData.game.state==game_state.WAITING){
		$('#ready-btn').removeClass('w3-disabled')
	} else { // start
		$('#ready-btn').addClass('w3-disabled')
	}


	$('#waiting-room').hide()
	$('#game-room').show()	

	//console.log(roomData)
	// list shared info
	reloadSlots(roomData)

	// show cards
	reloadCards(socket.id ,roomData)

	// show field
	reloadField(roomData)

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

socket.on('chat announce', (msg, color)=>{
	let $new_msg = $('<li>').text(msg)
	$new_msg.addClass('w3-text-'+color)
	$('#chat-messages').append($new_msg);
})

socket.on('chat message', (nickname, msg)=>{
	$('#chat-messages').append($('<li>').text(nickname+': '+msg));
	$('#chat-messages').scrollTop($('#chat-messages').prop("scrollHeight"));

})
/////////////////////////////////////
//
/////////////////////////////////////
function setPlayable(roomData){
	// check who?
	let cur = -1
	if (roomData.game.cur_order) // meaning game started and has an order set
		cur = roomData.game.cur_order[roomData.game.cur_order_idx]

	for (let i=0;i<8;i++)
		$('#player'+i).removeClass('w3-bottombar')
	$('#player'+cur).addClass('w3-bottombar')

	$('#play-btn').addClass('w3-disabled')
	for (const [sid, userData] of Object.entries(roomData.sockets)){
		// console.log(userData.seat+'=='+cur)
		if (cur == userData.seat && sid == socket.id){
			alert_big('Your turn!')
			// current seat no. equals the user's and if this client is that user
			$('#play-btn').removeClass('w3-disabled')
		} 
	}
}


function appendGameRoom(name, length){
	let $newli = $("<li class='w3-half w3-border game-room'><b>"+name+" - "+length+"/8</li>")
	$newli.on('click',()=>{
		//join room
		showLoadingText()
		socket.emit('join game room', name)
		$('#chat-messages').empty()
		
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
		$('#player'+user.seat).append($('<p>Cards: '+user.hand.length+'</p>'))

		if (roomData.game.state==game_state.WAITING){
			if (user.ready)
				$('#player'+user.seat).append($('<p>READY</p>'))
			else
				$('#player'+user.seat).append($('<p>NOT READY</p>'))
		} else {
			if (user.ready){

				$('#player'+user.seat).append($('<p>PLAYING</p>'))
				if (user.hand.length == 0)
					$('#player'+user.seat).append($('<p>WINNER</p>'))
				else
					$('#player'+user.seat).append($('<p>Turn: '+roomData.game.order[user.seat]+'</p>'))

			}
			else
				$('#player'+user.seat).append($('<p>SPECTATOR</p>'))
		}
	}

}

var card_colors = ['red','purple','indigo','light-blue','aqua','green','lime','khaki','amber','deep-orange','brown','gray','pink']
var selected_card = {}

function reloadCards(sid, roomData){
	selected_card = {}
	$('#play-btn').text('PASS').addClass('w3-red').removeClass('w3-green')
	
	// card -1
	// its roomData not user
	let userData = roomData.sockets[sid]

	userData.hand.sort(function(a, b) {
 		 return a - b;
	});
	let actual_card_count = 1

	$('#hand').empty()
	for (let i=0;i<userData.hand.length;i++){
		if (userData.hand[i] != -1){
			let $carddiv = $("<div class='cards w3-btn w3-border w3-border-black w3-display-container w3-"+card_colors[userData.hand[i]-1]+"' style='width: 69px; height:10vh; position:absolute; left: calc(100% * "+actual_card_count+" / "+userData.hand.length+
								"); top: 3vh'><div class='w3-display-topleft'>"+userData.hand[i]+"</div><div class='w3-display-bottomright'>"+userData.hand[i]+"</div></div>")
			
			$carddiv.on('mouseenter',()=>{
				if (!$carddiv.hasClass('selected'))
					$carddiv.css('top','1vh')

			})
			$carddiv.on('mouseleave',()=>{
				if (!$carddiv.hasClass('selected'))
					$carddiv.css('top','3vh')
			})

			$carddiv.on('click',()=>{
				if (!selected_card[userData.hand[i]]) 
					selected_card[userData.hand[i]] = 0

				if ($carddiv.hasClass('selected')){
					// unselect
					selected_card[userData.hand[i]]--
					if (selected_card[userData.hand[i]] == 0)
						delete selected_card[userData.hand[i]]
					
					$carddiv.removeClass('selected')
					$carddiv.css('top', '3vh')
				} else {
					//select
					selected_card[userData.hand[i]]++
					$carddiv.addClass('selected')
					$carddiv.css('top', '1vh')
				}
				
				// play/pass
				if (Object.keys(selected_card).length==0){
					$('#play-btn').text('PASS').addClass('w3-red').removeClass('w3-green')
				} else {
					$('#play-btn').text('PLAY').removeClass('w3-red').addClass('w3-green')
				}
			})


			$('#hand').append($carddiv)
			actual_card_count++
		}
	}
}

function reloadField(roomData){
	$('#field-section').empty()

	if (roomData.game.state==game_state.PLAYING)
		if (roomData.game.last){
			// to array
			let last_hand = roomData.game.last
			delete last_hand.num
			delete last_hand.count
			let last_array = []
			for (const [card, count] of Object.entries(last_hand)){
				    let m = count
				    while (m-- > 0) last_array.push(card)
			}
			
			//console.log(last_array)
			
			for (let i=0;i<last_array.length;i++){
				let $carddiv = $("<div class='w3-border w3-border-black w3-display-container w3-"+card_colors[last_array[i]-1]+"' style='width: 69px; height:10vh; position:absolute; left: calc(100% * "+i+" / "+last_array.length+
										"); top: 3vh'><div class='w3-display-topleft'>"+last_array[i]+"</div><div class='w3-display-bottomright'>"+last_array[i]+"</div></div>")

				$('#field-section').append($carddiv)
					
			}
		} 
}
const numberOfClientsSelectEl = document.querySelector('.number-of-clients-select');
const numberOfServersSelectEl = document.querySelector('.number-of-servers-select');
const paxosDemoUiContainerEl = document.querySelector('.paxos-demo-ui');

numberOfClientsSelectEl.addEventListener('change', onSelectsUpdated);
numberOfServersSelectEl.addEventListener('change', onSelectsUpdated);

const NIL = '—';

let paxosDemo;

onSelectsUpdated();

function onSelectsUpdated() {
	let numberOfClients = parseInt(numberOfClientsSelectEl.value, 10);
	let numberOfServers = parseInt(numberOfServersSelectEl.value, 10);

	paxosDemo = new PaxosDemo({
		clients: numberOfClients,
		servers: numberOfServers,
	});

	loop();

	function loop() {
		drawUI({
			paxosDemo,
			containerElement: paxosDemoUiContainerEl,

			onClientServerCommunication({ clientIndex, serverIndex }) {
				paxosDemo.clientServerCommunication({ clientIndex, serverIndex });

				loop();
			},
		});
	}
}

function PaxosDemo(options) {
	let {
		clients: clientsCount,
		servers: serversCount,
	} = options;

	let clients = new Array(clientsCount);
	let servers = new Array(serversCount);

	let logs = [];

	for (let i = 0; i < clientsCount; i++) {
		clients[i] = {
			proposingValue: null,
			defaultProposingValue: String.fromCharCode(65 + i), // big letter `A`

			clientIndex: i,
			phase: 0, // not started, 1,2 -- paxos, but not finished

			registerIndex: 0,
			getActualRegister() {
				return this.registerIndex * clientsCount + this.clientIndex;
			},

			serverPhases: (new Array(serversCount)).fill(0),

			maxPromisedRegister: -1,
			promisedValue: null,

			decided: null,
			proposesCollected: 0,

			onRejected() {
				this.phase = 0;
				this.registerIndex++;
				this.serverPhases.fill(0);

				this.proposesCollected = 0;

				this.maxPromisedRegister = -1;
				this.promisedValue = null;
				this.proposingValue = null;
			},
		};
	}

	for (let i = 0; i < serversCount; i++) {
		servers[i] = {
			registers: [],

			prepare({ register }) {
				if (register >= this.registers.length) {
					let createCount = register - this.registers.length + 1;

					while (createCount--) {
						this.registers.push(null);
					}
				}

				let promisedRegister;
				let promisedValue = null;

				for (let i = register - 1; i >= 0; i--) {
					let value = this.registers[i];

					if (value && (value !== NIL)) {
						promisedRegister = i;
						promisedValue = value;
						break;
					}
				}

				for (let i = 0; i < register; i++) {
					if (!this.registers[i]) {
						this.registers[i] = NIL;
					}
				}

				if (!this.registers[register]) { // Empty and not NIL
					let message = `PROMISED( R${register} `;

					if (promisedValue) {
						message += `, R${promisedRegister} , ${promisedValue} )`;
					} else {
						message += ')';
					}

					return {
						message,
						success: true,

						promisedRegister,
						promisedValue,
					};
				} else {
					return {
						message: `REJECTED( R${register} )`,
						success: false,
					};
				}
			},

			propose({ register, value }) {
				if (this.registers[register]) {
					return {
						message: `REJECTED( R${register} )`,
						success: false,
					};
				}

				this.registers[register] = value;

				return {
					message: `ACCEPTED( R${register} )`,
					success: true,
				};
			},
		};
	}

	this.getClientsCount = () => clientsCount;
	this.getServersCount = () => serversCount;

	this.getRegisters = function() {
		let serverRegisters = [];

		servers.forEach(server => {
			serverRegisters.push(server.registers);
		});

		let maxClientRegisterIndex = 0;

		clients.forEach(client => {
			if (client.registerIndex > maxClientRegisterIndex) {
				maxClientRegisterIndex = client.registerIndex;
			}
		});

		let desiredRegistersCount = (maxClientRegisterIndex + 1) * clientsCount;

		let registers = [];

		for (let i = 0; i < desiredRegistersCount; i++) {
			let arr = new Array(serversCount);
			registers.push(arr);

			serverRegisters.forEach((serverRegisters, serverIndex) => {
				if (i < serverRegisters.length) {
					arr[serverIndex] = serverRegisters[i];
				} else {
					arr[serverIndex] = null;
				}
			});
		}

		return registers;
	};
	this.getLogs = () => logs;

	this.isClientCanCommunicateWithServer = function({ clientIndex, serverIndex, registerIndex }) {
		let client = clients[clientIndex];

		if (typeof registerIndex === 'number') {
			if (client.getActualRegister() !== registerIndex) {
				return false;
			}
		}

		if (client.decided && client.phase === 0) return false;

		let serverPhase = client.serverPhases[serverIndex];

		return client.phase >= serverPhase;
	};

	this.clientServerCommunication = function({ clientIndex, serverIndex }) {
		let client = clients[clientIndex];
		let server = servers[serverIndex];

		let message;
		let serverMessage;

		let registerStr = `R${client.getActualRegister()}`;

		let phase = client.serverPhases[serverIndex];

		switch (phase) {
		case 0: {
			message = `PREPARE( ${registerStr} )`;
			client.serverPhases[serverIndex] = 1;

			let {
				message: serverMsg,
				success,

				promisedRegister,
				promisedValue,
			} = server.prepare({ register: client.getActualRegister() });

			serverMessage = serverMsg;

			if (promisedValue && !client.proposingValue) {
				if (promisedRegister > client.maxPromisedRegister) {
					client.maxPromisedRegister = promisedRegister;
					client.promisedValue = promisedValue;
				}
			}

			if (success) {
				// check quorum of prepares

				let preparedCount = 0;

				client.serverPhases.some(phase => {
					if (phase > 0) {
						preparedCount++;

						if (preparedCount > serversCount / 2) {
							client.phase = 1;
							return true;
						}
					}
				});
			} else {
				// forget about this register

				client.onRejected();
			}

			break; }
		case 1: {
			if (client.phase !== 1) throw new Error();

			if (!client.proposingValue) {
				if (client.promisedValue) {
					client.proposingValue = client.promisedValue;
				} else {
					client.proposingValue = client.defaultProposingValue;
				}
			}

			message = `PROPOSE( ${registerStr} , ${client.proposingValue} )`;

			let {
				message: serverMsg,
				success,
			} = server.propose({
				register: client.getActualRegister(),
				value: client.proposingValue,
			});

			serverMessage = serverMsg;

			client.serverPhases[serverIndex] = 2;

			if (success) {
				client.proposesCollected++;

				if (!client.decided && client.proposesCollected > serversCount / 2) {
					client.decided = client.proposingValue;

					logs.push({
						type: 'decided',

						sender: { type: 'client', index: clientIndex },
						receiver: { type: 'client', index: clientIndex },

						message: `DECIDED( ${client.proposingValue} )`,
					});
				}

				let allProposed = client.serverPhases.every(phase => phase === 2);

				if (allProposed) {
					client.onRejected(); // finished
				}
			} else {
				client.onRejected();
			}

			break; }
		}

		logs.push({
			sender: { type: 'client', index: clientIndex },
			receiver: { type: 'server', index: serverIndex },

			message,
		});

		logs.push({
			sender: { type: 'server', index: serverIndex },
			receiver: { type: 'client', index: clientIndex },

			message: serverMessage,
		});
	};
}

function drawUI(options) {
	let {
		paxosDemo,
		containerElement,

		onClientServerCommunication,
	} = options;

	containerElement.innerHTML = '<div><table class="registers-table"><thead></thead><tbody></tbody></table></div><div class="logs"></div>';

	let theadEl = containerElement.querySelector('thead');
	let tbodyEl = containerElement.querySelector('tbody');
	let logsEl = containerElement.querySelector('.logs');

	let clientsCount = paxosDemo.getClientsCount();
	let serversCount = paxosDemo.getServersCount();
	let registers = paxosDemo.getRegisters();

	let clientsFirstEmptyCells = new Array(clientsCount);
	for (let i = 0; i < clientsCount; i++) {
		clientsFirstEmptyCells[i] = new Array(serversCount);
	}

	{
		let tr = document.createElement('tr');

		tr.appendChild(document.createElement('th'));

		for (let i = 0; i < serversCount; i++) {
			let th = document.createElement('th');

			th.textContent = 'S' + i;

			tr.appendChild(th);
		}

		theadEl.appendChild(tr);
	}

	registers.forEach((serverValues, registerIndex) => {
		let tr = document.createElement('tr');

		let registerTh = document.createElement('th');
		registerTh.textContent = 'R' + registerIndex;
		tr.appendChild(registerTh);

		let registerClientIndex = registerIndex % clientsCount;
		let clientServersFirstEmptyCells = clientsFirstEmptyCells[registerClientIndex];

		serverValues.forEach((value, serverIndex) => {
			let td = document.createElement('td');
			td.className = 'register-cell';

			if (value) {
				td.textContent = value;
			}

			if (!clientServersFirstEmptyCells[serverIndex] && (!value || value === NIL)) {
				if (paxosDemo.isClientCanCommunicateWithServer({ clientIndex: registerClientIndex, serverIndex, registerIndex })) {
					clientServersFirstEmptyCells[serverIndex] = td;
				}
			}

			tr.appendChild(td);
		});

		tbodyEl.appendChild(tr);
	});

	clientsFirstEmptyCells.forEach((servers, clientIndex) => {
		servers.forEach((td, serverIndex) => {
			let div = document.createElement('div');

			let button = document.createElement('button');

			button.textContent = 'C' + clientIndex;

			button.addEventListener('click', () => {
				onClientServerCommunication({
					clientIndex,
					serverIndex,
				});
			});

			div.appendChild(button);
			td.appendChild(div);
		});
	});

	paxosDemo.getLogs().slice().reverse().forEach(log => {
		let {
			type,
			sender,
			receiver,
			message,
		} = log;

		let b = document.createElement('b');
		b.textContent = `${formatPerson(sender)} → ${formatPerson(receiver)}`;

		let span = document.createElement('span');
		span.textContent = message;

		let p = document.createElement('p');

		if (type === 'decided') {
			p.className = 'decided';
		}

		p.appendChild(b);
		p.appendChild(document.createTextNode(': '));
		p.appendChild(span);

		logsEl.appendChild(p);

		function formatPerson(person) {
			return (person.type === 'client' ? 'C' : 'S') + person.index;
		}
	});
}
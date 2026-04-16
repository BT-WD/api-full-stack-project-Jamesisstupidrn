// --- Global State ---
let playerHP = 100;
let playerMaxHP = 100;
let enemyHP = 100;
let wave = 1;
let bonusDamage = 0; // Reward: Increases your damage permanently
let isPlayerTurn = true;

// --- Core Game Functions ---

let playerMoves = []; // New global to store real move data

async function loadPokemon() {
    try {
        updateMenuButtons(false);
        const enemyID = Math.floor(Math.random() * 151) + 1;
        const enemyRes = await fetch(`https://pokeapi.co/api/v2/pokemon/${enemyID}`);
        const enemyData = await enemyRes.json();

        if (wave === 1) {
            const playerID = Math.floor(Math.random() * 151) + 1;
            const playerRes = await fetch(`https://pokeapi.co/api/v2/pokemon/${playerID}`);
            const playerData = await playerRes.json();
            
            document.getElementById('player-name').innerText = playerData.name.toUpperCase();
            document.getElementById('player-sprite').src = playerData.sprites.back_default;
            
            // --- NEW: Fetch Move Details ---
            const moveUrls = playerData.moves.slice(0, 4).map(m => m.move.url);
            const movePromises = moveUrls.map(url => fetch(url).then(res => res.json()));
            playerMoves = await Promise.all(movePromises);
            
            playerMoves.forEach((move, i) => {
                document.getElementById(`btn-${i+1}`).innerText = move.name.replace('-', ' ').toUpperCase();
            });
            playerHP = 100;
        }

        enemyHP = 100;
        document.getElementById('wave-count').innerText = wave;
        document.getElementById('enemy-name').innerText = enemyData.name.toUpperCase();
        document.getElementById('enemy-sprite').src = enemyData.sprites.front_default;
        
        updateHPBar('enemy-hp-fill', enemyHP);
        updateHPBar('player-hp-fill', (playerHP / playerMaxHP) * 100);
        
        isPlayerTurn = true;
        updateMenuButtons(true);
    } catch (error) {
        console.error("Initialization failed:", error);
    }
}



function handleAttack(move) {
    if (!isPlayerTurn || enemyHP <= 0 || playerHP <= 0) return;

    isPlayerTurn = false;
    updateMenuButtons(false);

    // 1. Player Move
    executeMove('player', move);

    // 2. Enemy Move (if still alive)
    if (enemyHP > 0) {
        setTimeout(() => {
            executeMove('enemy', 'move1'); // Simplified AI: Always attacks
            
            if (playerHP > 0) {
                setTimeout(() => {
                    isPlayerTurn = true;
                    updateMenuButtons(true);
                }, 800);
            }
        }, 1000);
    }
}

function executeMove(attacker, moveIndex) {
    const isPlayer = attacker === 'player';
    const move = isPlayer ? playerMoves[moveIndex] : { power: 40, name: 'Tackle' };
    const attackerName = isPlayer ? document.getElementById('player-name').innerText : document.getElementById('enemy-name').innerText;

    if (move.power > 0) {
        let damage = Math.floor(move.power / 5) + Math.floor(Math.random() * 5);
        if (isPlayer) damage += bonusDamage;

        if (isPlayer) {
            enemyHP = Math.max(0, enemyHP - damage);
            updateHPBar('enemy-hp-fill', enemyHP);
            
            // PRINT TO LOG
            logMessage(`${attackerName} used ${move.name.toUpperCase()}! It dealt ${damage} damage.`);
            
            if (enemyHP <= 0) {
                logMessage(`${document.getElementById('enemy-name').innerText} fainted!`);
                return triggerWin();
            }
        } else {
            playerHP = Math.max(0, playerHP - damage);
            updateHPBar('player-hp-fill', (playerHP / playerMaxHP) * 100);
            
            // PRINT TO LOG
            logMessage(`The wild ${attackerName} used ${move.name.toUpperCase()}! It dealt ${damage} damage.`);
            
            if (playerHP <= 0) triggerLoss();
        }
    } else {
        // Handle Healing Log
        if (move.name.includes('recover') || move.name.includes('heal')) {
            playerHP = Math.min(playerMaxHP, playerHP + 30);
            updateHPBar('player-hp-fill', (playerHP / playerMaxHP) * 100);
            logMessage(`${attackerName} used ${move.name.toUpperCase()} and restored health!`);
        }
    }
}


function logMessage(text) {
    const log = document.getElementById('battle-log');
    const msg = document.createElement('p');
    msg.innerText = `> ${text}`;
    log.prepend(msg); // Adds new messages to the top
}


// --- Progression Systems ---

function triggerWin() {
    setTimeout(() => {
        document.getElementById('reward-screen').style.display = 'flex';
    }, 500);
}

function applyReward(type) {
    if (type === 'HEAL') {
        playerHP = Math.min(playerMaxHP, playerHP + 40);
    } else if (type === 'ATTACK') {
        bonusDamage += 5;
    }
    
    wave++;
    document.getElementById('reward-screen').style.display = 'none';
    loadPokemon(); // Start next floor
}

function triggerLoss() {
    alert(`Game Over! You reached Wave ${wave}.`);
    location.reload();
}

// --- UI Helpers ---

function updateHPBar(id, percent) {
    const bar = document.getElementById(id);
    bar.style.width = percent + "%";
    
    // Visual indicator: Green -> Yellow -> Red
    if (percent > 50) bar.style.backgroundColor = "#4caf50";
    else if (percent > 20) bar.style.backgroundColor = "#ffeb3b";
    else bar.style.backgroundColor = "#f44336";
}

function updateMenuButtons(enabled) {
    document.querySelectorAll('.move-btn').forEach(btn => btn.disabled = !enabled);
}

// Initialize
loadPokemon();

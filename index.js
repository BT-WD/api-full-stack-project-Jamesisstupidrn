
// Game State
let playerHP = 100;
let enemyHP = 100;

// Fetch Pokémon Data from PokeAPI
async function loadPokemon() {
    try {
        // Get random IDs between 1 and 151 (Original Gen 1)
        const playerID = Math.floor(Math.random() * 151) + 1;
        const enemyID = Math.floor(Math.random() * 151) + 1;

        const [playerRes, enemyRes] = await Promise.all([
            fetch(`https://pokeapi.co/api/v2/pokemon/${playerID}`),
            fetch(`https://pokeapi.co/api/v2/pokemon/${enemyID}`)
        ]);

        const playerData = await playerRes.json();
        const enemyData = await enemyRes.json();

        // Set Names and Sprites
        document.getElementById('player-name').innerText = playerData.name.toUpperCase();
        document.getElementById('enemy-name').innerText = enemyData.name.toUpperCase();
        
        // Classic view: Player shows back, Enemy shows front
        document.getElementById('player-sprite').src = playerData.sprites.back_default;
        document.getElementById('enemy-sprite').src = enemyData.sprites.front_default;

    } catch (error) {
        console.error("Failed to fetch Pokémon:", error);
    }
}

// Battle Logic
// New Global State
let isPlayerTurn = true;

function handleAttack(move) {
    // 1. Guard Clause: Don't allow moves if it's not your turn or game is over
    if (!isPlayerTurn || enemyHP <= 0 || playerHP <= 0) return;

    // Immediately lock the turn
    isPlayerTurn = false;
    updateMenuButtons(false); // Visually disable buttons

    // 2. PLAYER PHASE
    executeMove('player', move);

    // 3. ENEMY PHASE (Triggers after a delay if enemy didn't faint)
    if (enemyHP > 0) {
        setTimeout(() => {
            const enemyMoves = ['move1', 'move1', 'move1', 'move2']; // AI logic
            const randomMove = enemyMoves[Math.floor(Math.random() * enemyMoves.length)];
            
            executeMove('enemy', randomMove);

            // Turn ends: Unlock for player
            setTimeout(() => {
                isPlayerTurn = true;
                updateMenuButtons(true);
            }, 1000);
        }, 1200);
    }
}

// Helper to handle the actual mechanics for either side
function executeMove(attacker, move) {
    const target = attacker === 'player' ? 'enemy' : 'player';
    
    if (move === 'move1' || move === 'move3') { // Attacks
        let damage = Math.floor(Math.random() * 15) + 10;
        if (target === 'enemy') {
            enemyHP = Math.max(0, enemyHP - damage);
            updateHPBar('enemy-hp-fill', enemyHP);
        } else {
            playerHP = Math.max(0, playerHP - damage);
            updateHPBar('player-hp-fill', playerHP);
        }
    } else if (move === 'move4') { // Heal
        let healAmount = 25;
        playerHP = Math.min(100, playerHP + healAmount);
        updateHPBar('player-hp-fill', playerHP);
    }
    // move2 (Growl) can be added here later to lower damage stats
}

// Function to enable/disable buttons so you can't click during enemy turn
function updateMenuButtons(enabled) {
    const buttons = document.querySelectorAll('.move-btn');
    buttons.forEach(btn => {
        btn.disabled = !enabled;
        btn.style.opacity = enabled ? "1" : "0.5";
        btn.style.cursor = enabled ? "pointer" : "not-allowed";
    });
}



// Update the CSS width of the health bars
function updateHPBar(elementId, health) {
    const bar = document.getElementById(elementId);
    bar.style.width = health + "%";
    
    // Change color based on health remaining
    if (health < 20) bar.style.backgroundColor = "#f44336"; // Red
    else if (health < 50) bar.style.backgroundColor = "#ffeb3b"; // Yellow
}

// Start the game
loadPokemon();

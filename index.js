// --- Global State ---
let playerHP = 100, playerMaxHP = 100, playerLevel = 1, playerXP = 0, xpToNextLevel = 100;
let enemyHP = 100, enemyMaxHP = 100, enemyLevel = 1;
let playerStatus = null, enemyStatus = null; // Track status effects
let wave = 1, bonusDamage = 0, isPlayerTurn = true, playerMoves = [];
// Separate multiplier to make levels meaningfully increase damage without stacking raw bonuses
let playerDamageMultiplier = 1.0;
// Inventory for items
let items = { POTION: 1, ETHER: 0 };
// X-Attack items count (temporary attack buff when used)
let xAttacks = 0;
// Combat stats (will be initialized from API data when available)
let playerAttack = 10, playerDefense = 10, playerSpAtk = 10, playerSpDef = 10, playerSpeed = 10;
let enemyAttack = 10, enemyDefense = 10, enemySpAtk = 10, enemySpDef = 10, enemySpeed = 10;
// Stat stages (-6..+6) for temporary buffs/debuffs
let playerStatStage = { attack:0, defense:0, 'special-attack':0, 'special-defense':0, speed:0 };
let enemyStatStage = { attack:0, defense:0, 'special-attack':0, 'special-defense':0, speed:0 };

function statStageMultiplier(stage) {
    // Pokemon-style stage multipliers: if stage>=0 -> (2+stage)/2, else -> 2/(2-stage)
    if (stage >= 0) return (2 + stage) / 2;
    return 2 / (2 - stage);
}

// --- Core Game Functions ---

async function loadPokemon() {
    try {
        updateMenuButtons(false);
        const enemyID = Math.floor(Math.random() * 151) + 1;
        const enemyRes = await fetch(`https://pokeapi.co/api/v2/pokemon/${enemyID}`);
        const enemyData = await enemyRes.json();

        // Initialize enemy stats from API (scale slightly with enemyLevel set in setEnemyStats)
        const enemyStatsMap = {};
        enemyData.stats.forEach(s => { enemyStatsMap[s.stat.name] = s.base_stat; });
        enemyAttack = Math.max(1, Math.floor((enemyStatsMap['attack'] || 10) * (1 + (enemyLevel - 1) * 0.05)));
        enemyDefense = Math.max(1, Math.floor((enemyStatsMap['defense'] || 10) * (1 + (enemyLevel - 1) * 0.05)));
        enemySpAtk = Math.max(1, Math.floor((enemyStatsMap['special-attack'] || 8) * (1 + (enemyLevel - 1) * 0.04)));
        enemySpDef = Math.max(1, Math.floor((enemyStatsMap['special-defense'] || 8) * (1 + (enemyLevel - 1) * 0.04)));
        enemySpeed = Math.max(1, Math.floor((enemyStatsMap['speed'] || 10) * (1 + (enemyLevel - 1) * 0.03)));

        setEnemyStats();
        enemyStatus = null; // Reset status for new enemy
        document.getElementById('enemy-name').innerText = enemyData.name.toUpperCase();
        document.getElementById('enemy-sprite').src = enemyData.sprites.front_default;

        if (wave === 1) {
            // Only load player and moves if playerMoves empty (preserve PP across waves/level ups)
            if (playerMoves.length === 0) {
                const playerID = Math.floor(Math.random() * 151) + 1;
                const playerRes = await fetch(`https://pokeapi.co/api/v2/pokemon/${playerID}`);
                const playerData = await playerRes.json();
                document.getElementById('player-name').innerText = playerData.name.toUpperCase();
                document.getElementById('player-sprite').src = playerData.sprites.back_default;
                
                const moveUrls = playerData.moves.slice(0, 4).map(m => m.move.url);
                const movePromises = moveUrls.map(url => fetch(url).then(res => res.json()));
                playerMoves = await Promise.all(movePromises);
                
                // Initialize PP for each move if not present
                playerMoves.forEach((move, i) => {
                    if (move.currentPP === undefined) move.currentPP = move.pp || 5; // fallback PP
                    const btn = document.getElementById(`btn-${i+1}`);
                    if (btn) {
                        btn.innerText = `${move.name.replace('-', ' ').toUpperCase()} (PP ${move.currentPP}/${move.pp || 5})`;
                        btn.disabled = false;
                    }
                });

                // Initialize player stats from API
                const playerStatsMap = {};
                playerData.stats.forEach(s => { playerStatsMap[s.stat.name] = s.base_stat; });
                playerAttack = Math.max(1, Math.floor((playerStatsMap['attack'] || 10) * (1 + (playerLevel - 1) * 0.05)));
                playerDefense = Math.max(1, Math.floor((playerStatsMap['defense'] || 10) * (1 + (playerLevel - 1) * 0.05)));
                playerSpAtk = Math.max(1, Math.floor((playerStatsMap['special-attack'] || 8) * (1 + (playerLevel - 1) * 0.04)));
                playerSpDef = Math.max(1, Math.floor((playerStatsMap['special-defense'] || 8) * (1 + (playerLevel - 1) * 0.04)));
                playerSpeed = Math.max(1, Math.floor((playerStatsMap['speed'] || 10) * (1 + (playerLevel - 1) * 0.03)));
            } else {
                // Update button labels to reflect current PP without resetting it
                playerMoves.forEach((move, i) => {
                    const btn = document.getElementById(`btn-${i+1}`);
                    if (btn) btn.innerText = `${move.name.replace('-', ' ').toUpperCase()} (PP ${move.currentPP}/${move.pp || 5})`;
                });
            }
             updateXPBar();
        }

        document.getElementById('wave-count').innerText = wave;
        updateHPBar('enemy-hp-fill', 100);
        updateHPBar('player-hp-fill', (playerHP / playerMaxHP) * 100);
        isPlayerTurn = true;
        updateMenuButtons(true);
    } catch (error) {
        console.error("Initialization failed:", error);
    }
}

function setEnemyStats() {
    enemyLevel = Math.max(1, wave + (Math.floor(Math.random() * 3) - 1));
    document.getElementById('enemy-lvl-text').innerText = enemyLevel;
    enemyMaxHP = 80 + (enemyLevel * 15);
    enemyHP = enemyMaxHP; 
}

async function handleAttack(moveIndex) {
    if (!isPlayerTurn || enemyHP <= 0 || playerHP <= 0) return;
    // Prevent using moves with no PP
    if (playerMoves[moveIndex] && playerMoves[moveIndex].currentPP <= 0) {
        // If all moves are out of PP and no Ether, player loses
        const totalPP = playerMoves.reduce((sum, m) => sum + (m.currentPP || 0), 0);
        if (totalPP <= 0 && (items.ETHER || 0) <= 0) {
            logMessage('All moves are out of PP and no ETHER left!');
            return triggerLoss();
        }
        logMessage('No PP left for that move!');
        return;
    }
    isPlayerTurn = false;
    updateMenuButtons(false);

    // 1. Player Turn
    await executeMove('player', moveIndex);
    if (enemyHP > 0) applyStatusDamage('enemy');

    // 2. Enemy Turn
    if (enemyHP > 0) {
        setTimeout(async () => {
            await executeMove('enemy', 0);
            if (playerHP > 0) {
                applyStatusDamage('player');
                setTimeout(() => {
                    isPlayerTurn = true;
                    updateMenuButtons(true);
                }, 800);
            }
        }, 1000);
    }
}

async function executeMove(attacker, moveIndex) {
    const isPlayer = attacker === 'player';
    const move = isPlayer ? playerMoves[moveIndex] : { power: 40, name: 'Tackle', meta: null };
    // Decrement PP for player moves and update UI
    if (isPlayer) {
        if (move.currentPP === undefined) move.currentPP = move.pp || 5;
        move.currentPP = Math.max(0, move.currentPP - 1);
        const btn = document.getElementById(`btn-${moveIndex+1}`);
        if (btn) btn.innerText = `${move.name.replace('-', ' ').toUpperCase()} (PP ${move.currentPP}/${move.pp || 5})`;
        if (move.currentPP <= 0) {
            const btnDisable = document.getElementById(`btn-${moveIndex+1}`);
            if (btnDisable) btnDisable.disabled = true;
        }
    }
    const attackerName = isPlayer ? document.getElementById('player-name').innerText : document.getElementById('enemy-name').innerText;
    const status = isPlayer ? playerStatus : enemyStatus;

    // Check Paralysis skip (25% chance)
    if (status === 'paralysis' && Math.random() < 0.25) {
        logMessage(`${attackerName} is paralyzed! It can't move!`);
        return;
    }

    // Determine damage class early
    const damageClass = move.damage_class && move.damage_class.name ? move.damage_class.name : (move.meta && move.meta.category ? move.meta.category : 'physical');

    // If this is a pure status move (no power), apply stat changes / status and return
    if ((!move.power || move.power === 0) && damageClass === 'status') {
        // Apply stat changes if any
        if (move.stat_changes && move.stat_changes.length > 0) {
            const chance = move.meta && (move.meta.stat_chance || move.meta.ailment_chance || move.effect_chance) ? (move.meta.stat_chance || move.meta.ailment_chance || move.effect_chance) : 100;
            if (Math.random() * 100 <= chance) {
                move.stat_changes.forEach(sc => {
                    const statName = sc.stat.name;
                    const change = sc.change || 0;
                    // Determine target: move.target may indicate 'user'/'self'
                    const targetIsUser = move.target && move.target.name && (/user|self/.test(move.target.name));
                    const stages = targetIsUser ? (isPlayer ? playerStatStage : enemyStatStage) : (isPlayer ? enemyStatStage : playerStatStage);
                    stages[statName] = Math.max(-6, Math.min(6, (stages[statName] || 0) + change));
                    logMessage(`${(targetIsUser ? attackerName : (isPlayer ? document.getElementById('enemy-name').innerText : document.getElementById('player-name').innerText))}'s ${statName.toUpperCase()} ${change>0 ? 'rose' : 'fell'} by ${Math.abs(change)} stage(s)!`);
                });
            }
        }

        // Apply status ailment if present
        if (move.meta && move.meta.ailment && move.meta.ailment.name !== 'none') {
            const chance = move.meta.ailment_chance || 100;
            if (Math.random() * 100 <= chance) {
                if (isPlayer) { enemyStatus = move.meta.ailment.name; logMessage(`Enemy was ${enemyStatus}ed!`); }
                else { playerStatus = move.meta.ailment.name; logMessage(`You were ${playerStatus}ed!`); }
            }
        }

        return; // done for status-only moves
    }

    let hits = (isPlayer && move.meta && move.meta.max_hits) ? 
               Math.floor(Math.random() * (move.meta.max_hits - (move.meta.min_hits || 1) + 1)) + (move.meta.min_hits || 1) : 1;

    // base values calculated once per move
    let basePower = move.power || 40;
    let baseDamage = Math.floor(basePower / 5);
    let totalDamageDealt = 0;

    for (let i = 0; i < hits; i++) {
        // Random variance per hit (85% - 115%)
        const variance = 0.85 + Math.random() * 0.3;

        // Critical hit chance (base fixed ~6.25%)
        const critChance = 6.25;
        const isCrit = (Math.random() * 100) < critChance;
        const critMultiplier = isCrit ? 1.5 : 1;

        // Trigger attack animation for attacker
        if (isPlayer) {
            const sprite = document.getElementById('player-sprite');
            sprite.classList.remove('attack-anim-player');
            void sprite.offsetWidth;
            sprite.classList.add('attack-anim-player');
            // Ensure the class is removed after animation so it can be retriggered next time
            sprite.addEventListener('animationend', () => sprite.classList.remove('attack-anim-player'), { once: true });
        } else {
            const sprite = document.getElementById('enemy-sprite');
            sprite.classList.remove('attack-anim-enemy');
            void sprite.offsetWidth;
            sprite.classList.add('attack-anim-enemy');
            sprite.addEventListener('animationend', () => sprite.classList.remove('attack-anim-enemy'), { once: true });
        }

        // Determine whether move is physical or special (already computed)
        let attackerStat, defenderStat;
         if (damageClass === 'special') {
             attackerStat = isPlayer ? playerSpAtk : enemySpAtk;
             defenderStat = isPlayer ? enemySpDef : playerSpDef;
         } else {
             attackerStat = isPlayer ? playerAttack : enemyAttack;
             defenderStat = isPlayer ? enemyDefense : playerDefense;
         }
        
        // Apply stat stages multipliers
        const attackerStage = isPlayer ? (damageClass === 'special' ? playerStatStage['special-attack'] : playerStatStage.attack) : (damageClass === 'special' ? enemyStatStage['special-attack'] : enemyStatStage.attack);
        const defenderStage = isPlayer ? (damageClass === 'special' ? enemyStatStage['special-defense'] : enemyStatStage.defense) : (damageClass === 'special' ? playerStatStage['special-defense'] : playerStatStage.defense);
        const effectiveAttacker = Math.max(1, Math.floor(attackerStat * statStageMultiplier(attackerStage)));
        const effectiveDefender = Math.max(1, Math.floor(defenderStat * statStageMultiplier(defenderStage)));

        // Apply stat-based damage formula. Scale down to keep values reasonable.
        let statFactor = effectiveAttacker / Math.max(1, effectiveDefender);
        let raw = (basePower * statFactor) / 6; // base scaling
        if (isPlayer) raw = raw * playerDamageMultiplier + bonusDamage;
        let finalDamage = Math.max(1, Math.floor(raw * variance * critMultiplier));

        if (isPlayer) {
            enemyHP = Math.max(0, enemyHP - finalDamage);
            updateHPBar('enemy-hp-fill', (enemyHP / enemyMaxHP) * 100);
            // Flash and special effect on enemy when hit
            const es = document.getElementById('enemy-sprite');
            es.classList.remove('hit-flash', 'special-anim');
            void es.offsetWidth;
            es.classList.add('hit-flash');
            es.addEventListener('animationend', () => es.classList.remove('hit-flash'), { once: true });
            if (damageClass === 'special') { es.classList.add('special-anim'); setTimeout(() => es.classList.remove('special-anim'), 500); }
         } else {
            playerHP = Math.max(0, playerHP - finalDamage);
            updateHPBar('player-hp-fill', (playerHP / playerMaxHP) * 100);
            // Flash and special effect on player when hit
            const ps = document.getElementById('player-sprite');
            ps.classList.remove('hit-flash', 'special-anim');
            void ps.offsetWidth;
            ps.classList.add('hit-flash');
            ps.addEventListener('animationend', () => ps.classList.remove('hit-flash'), { once: true });
            if (damageClass === 'special') { ps.classList.add('special-anim'); setTimeout(() => ps.classList.remove('special-anim'), 500); }
         }
        
        totalDamageDealt += finalDamage;
        if (isCrit) logMessage('A critical hit!');
        logMessage(`${attackerName} used ${move.name.toUpperCase()}! ${hits > 1 ? `Hit ${i+1} for ${finalDamage} dmg${isCrit ? ' (CRIT)' : ''}!` : `Dealt ${finalDamage} damage.`}`);
        
        if (enemyHP <= 0 || playerHP <= 0) break;
        if (hits > 1) await new Promise(r => setTimeout(r, 200));
    }

    // After damage, apply drain/recoil if present
    if (move.meta && move.meta.drain) {
        const healAmount = Math.floor(totalDamageDealt * (move.meta.drain / 100));
        if (isPlayer) {
            playerHP = Math.min(playerMaxHP, playerHP + healAmount);
            updateHPBar('player-hp-fill', (playerHP / playerMaxHP) * 100);
            logMessage(`${attackerName} drained ${healAmount} HP!`);
        } else {
            enemyHP = Math.min(enemyMaxHP, enemyHP + healAmount);
            updateHPBar('enemy-hp-fill', (enemyHP / enemyMaxHP) * 100);
            logMessage(`${attackerName} drained ${healAmount} HP!`);
        }
    }
    if (move.meta && move.meta.recoil) {
        const recoilAmount = Math.floor(totalDamageDealt * (move.meta.recoil / 100));
        if (isPlayer) {
            playerHP = Math.max(0, playerHP - recoilAmount);
            updateHPBar('player-hp-fill', (playerHP / playerMaxHP) * 100);
            logMessage(`${attackerName} took ${recoilAmount} recoil damage!`);
            if (playerHP <= 0) return triggerLoss();
        } else {
            enemyHP = Math.max(0, enemyHP - recoilAmount);
            updateHPBar('enemy-hp-fill', (enemyHP / enemyMaxHP) * 100);
            logMessage(`${attackerName} took ${recoilAmount} recoil damage!`);
            if (enemyHP <= 0) return triggerWin();
        }
    }

    // Apply Status from move meta (existing behavior)
    if (move.meta && move.meta.ailment && move.meta.ailment.name !== 'none') {
        const chance = move.meta.ailment_chance || 100;
        if (Math.random() * 100 <= chance) {
            if (isPlayer) { enemyStatus = move.meta.ailment.name; logMessage(`Enemy was ${enemyStatus}ed!`); }
            else { playerStatus = move.meta.ailment.name; logMessage(`You were ${playerStatus}ed!`); }
        }
    }

    // Apply stat changes that occur on hit (some moves provide stat_changes in their move data)
    if (move.stat_changes && move.stat_changes.length > 0) {
        const chance = move.meta && (move.meta.stat_chance || move.effect_chance) ? (move.meta.stat_chance || move.effect_chance) : 100;
        if (Math.random() * 100 <= chance) {
            move.stat_changes.forEach(sc => {
                const statName = sc.stat.name;
                const change = sc.change || 0;
                // Target for on-hit stat changes is usually the move.target
                const targetIsUser = move.target && move.target.name && (/user|self/.test(move.target.name));
                const stages = targetIsUser ? (isPlayer ? playerStatStage : enemyStatStage) : (isPlayer ? enemyStatStage : playerStatStage);
                stages[statName] = Math.max(-6, Math.min(6, (stages[statName] || 0) + change));
                logMessage(`${(targetIsUser ? attackerName : (isPlayer ? document.getElementById('enemy-name').innerText : document.getElementById('player-name').innerText))}'s ${statName.toUpperCase()} ${change>0 ? 'rose' : 'fell'} by ${Math.abs(change)} stage(s)!`);
            });
        }
    }

    if (isPlayer && enemyHP <= 0) return triggerWin();
    if (!isPlayer && playerHP <= 0) return triggerLoss();
}

function applyStatusDamage(target) {
    const isPlayer = target === 'player';
    const status = isPlayer ? playerStatus : enemyStatus;
    if (status === 'poison' || status === 'burn') {
        const damage = Math.floor((isPlayer ? playerMaxHP : enemyMaxHP) * 0.06);
        if (isPlayer) {
            playerHP = Math.max(0, playerHP - damage);
            updateHPBar('player-hp-fill', (playerHP / playerMaxHP) * 100);
            logMessage(`Poison/Burn dealt ${damage} damage to you!`);
            if (playerHP <= 0) triggerLoss();
        } else {
            enemyHP = Math.max(0, enemyHP - damage);
            updateHPBar('enemy-hp-fill', (enemyHP / enemyMaxHP) * 100);
            logMessage(`Poison/Burn dealt ${damage} damage to enemy!`);
            if (enemyHP <= 0) triggerWin();
        }
    }
}

// --- Progression & UI Helpers ---

function triggerWin() {
    logMessage(`${document.getElementById('enemy-name').innerText} fainted!`);
    playerXP += (40 + (wave * 10));
    if (playerXP >= xpToNextLevel) levelUp();
    updateXPBar();
    // Ensure reward buttons are clickable even if move buttons were disabled during the turn
    document.querySelectorAll('#reward-screen .move-btn').forEach(btn => btn.disabled = false);
    setTimeout(() => { document.getElementById('reward-screen').style.display = 'flex'; }, 500);
}

// When game over, persist run stats
function triggerLoss() { 
    // Record run
    const runRecord = { wave: wave, xp: playerXP, time: Date.now() };
    runStats.recentRuns = runStats.recentRuns || [];
    runStats.recentRuns.push(runRecord);
    runStats.totalXP = (runStats.totalXP || 0) + playerXP;
    if ((runStats.bestWave || 0) < wave) runStats.bestWave = wave;
    saveRunStats();
    loadRunStats();

    alert(`Game Over! Wave ${wave}.`); location.reload(); }

function levelUp() {
    playerLevel++;
    playerXP -= xpToNextLevel;
    xpToNextLevel = Math.floor(xpToNextLevel * 1.2); 
    playerMaxHP += 20;
    playerHP = playerMaxHP;
    playerStatus = null; // Heal status on level up
    // Increase player's damage multiplier to make levels feel impactful without inflating raw bonus values
    playerDamageMultiplier += 0.06; // +6% damage per level
    // Also slightly increase core stats so levels feel meaningful
    playerAttack = Math.max(1, Math.floor(playerAttack * 1.04));
    playerDefense = Math.max(1, Math.floor(playerDefense * 1.04));
    playerSpAtk = Math.max(1, Math.floor(playerSpAtk * 1.03));
    playerSpDef = Math.max(1, Math.floor(playerSpDef * 1.03));
    playerSpeed = Math.max(1, Math.floor(playerSpeed * 1.02));
     logMessage(`LEVEL UP! Now Lv. ${playerLevel}.`);
}

function openItemScreen() {
    renderItemScreen();
    document.getElementById('item-screen').style.display = 'flex';
}

function closeItemScreen() {
    document.getElementById('item-screen').style.display = 'none';
}

function renderItemScreen() {
    const list = document.getElementById('item-list');
    list.innerHTML = '';
    for (const [key, count] of Object.entries(items)) {
        const btn = document.createElement('button');
        btn.className = 'item-btn';
        btn.disabled = count <= 0;
        btn.innerHTML = `<b>${key}</b><br><small>x${count}</small>`;
        btn.onclick = () => { useItem(key); };
        list.appendChild(btn);
    }
    // Show X-ATTACK as separate item
    const xaBtn = document.createElement('button');
    xaBtn.className = 'item-btn';
    xaBtn.disabled = (xAttacks || 0) <= 0;
    xaBtn.innerHTML = `<b>X-ATTACK</b><br><small>x${xAttacks || 0}</small>`;
    xaBtn.onclick = () => { if ((xAttacks||0)>0) { xAttacks--; playerStatStage.attack = Math.min(6, (playerStatStage.attack||0)+1); renderItemScreen(); logMessage('Used X-ATTACK. Attack rose by 1 stage!'); } };
    list.appendChild(xaBtn);
}

function useItem(type) {
    if (!items[type] || items[type] <= 0) return;
    if (type === 'POTION') {
        playerHP = Math.min(playerMaxHP, playerHP + 50);
        logMessage('Used POTION. Restored 50 HP.');
    } else if (type === 'ETHER') {
        // Restore 5 PP to all moves
        playerMoves.forEach(move => {
            if (move) {
                move.currentPP = (move.currentPP || 0) + 5;
                if (move.pp && move.currentPP > move.pp) move.currentPP = move.pp;
            }
        });
        // Update buttons and re-enable if needed
        playerMoves.forEach((move, i) => {
            const btn = document.getElementById(`btn-${i+1}`);
            if (btn) {
                btn.innerText = `${move.name.replace('-', ' ').toUpperCase()} (PP ${move.currentPP}/${move.pp || 5})`;
                if (move.currentPP > 0) btn.disabled = false;
            }
        });
        logMessage('Used ETHER. Restored 5 PP to all moves.');
    }
    else if (type === 'XATTACK') {
        // Using X-ATTACK applies a permanent (for battle) +1 attack stage (like Gen I)
        // We'll implement X-ATTACK as an item that when used increases player's attack stage by 1
        playerStatStage.attack = Math.min(6, (playerStatStage.attack || 0) + 1);
        logMessage('Used X-ATTACK. Attack rose by 1 stage!');
    }
    items[type]--;
    renderItemScreen();
    updateHPBar('player-hp-fill', (playerHP / playerMaxHP) * 100);
}

// Give item as reward
function giveRandomItem() {
    // Now X-ATTACK is only given via random item pool
    const r = Math.random();
    if (r < 0.5) { items.POTION = (items.POTION || 0) + 1; logMessage('Received a POTION!'); }
    else if (r < 0.85) { items.ETHER = (items.ETHER || 0) + 1; logMessage('Received an ETHER!'); }
    else { xAttacks = (xAttacks || 0) + 1; logMessage('Received an X-ATTACK!'); }
}

function applyReward(type) {
    if (type === 'HEAL') playerHP = Math.min(playerMaxHP, playerHP + 40);
    else if (type === 'ITEM') giveRandomItem();
    wave++;
    document.getElementById('reward-screen').style.display = 'none';
    loadPokemon();
}

function triggerLoss() { 
    // Record run
    const runRecord = { wave: wave, xp: playerXP, time: Date.now() };
    runStats.recentRuns = runStats.recentRuns || [];
    runStats.recentRuns.push(runRecord);
    runStats.totalXP = (runStats.totalXP || 0) + playerXP;
    if ((runStats.bestWave || 0) < wave) runStats.bestWave = wave;
    saveRunStats();
    loadRunStats();

    alert(`Game Over! Wave ${wave}.`); location.reload(); }

function updateHPBar(id, percent) {
    const bar = document.getElementById(id);
    bar.style.width = percent + "%";
    bar.style.backgroundColor = percent > 50 ? "#4caf50" : (percent > 20 ? "#ffeb3b" : "#f44336");
}

function updateXPBar() {
    document.getElementById('player-xp-fill').style.width = Math.min(100, (playerXP / xpToNextLevel) * 100) + "%";
    document.getElementById('player-lvl-text').innerText = playerLevel;
}

function updateMenuButtons(enabled) { document.querySelectorAll('.move-btn').forEach(btn => btn.disabled = !enabled); }
function logMessage(text) {
    const log = document.getElementById('battle-log');
    const msg = document.createElement('p');
    msg.innerText = `> ${text}`;
    log.prepend(msg);
}

// Run stats / leaderboard (persisted in localStorage)
let runStats = { bestWave: 0, totalXP: 0, recentRuns: [] };

function loadRunStats() {
    try {
        const raw = localStorage.getItem('pokerogue.runStats');
        if (raw) runStats = JSON.parse(raw);
    } catch (e) { console.warn('Failed to load run stats', e); }
    document.getElementById('best-wave').innerText = runStats.bestWave || 0;
    document.getElementById('total-xp').innerText = runStats.totalXP || 0;
    renderRecentRuns();
}

function saveRunStats() {
    try { localStorage.setItem('pokerogue.runStats', JSON.stringify(runStats)); }
    catch (e) { console.warn('Failed to save run stats', e); }
}

function renderRecentRuns() {
    const container = document.getElementById('recent-runs');
    container.innerHTML = '';
    (runStats.recentRuns || []).slice().reverse().forEach(r => {
        const el = document.createElement('div');
        el.innerText = `Wave ${r.wave} — XP ${r.xp} — ${new Date(r.time).toLocaleString()}`;
        container.appendChild(el);
    });
}

function clearRunStats() {
    runStats = { bestWave: 0, totalXP: 0, recentRuns: [] };
    saveRunStats();
    loadRunStats();
}

loadPokemon();
// Initialize run stats UI
loadRunStats();
// Wire clear button
document.getElementById('clear-stats-btn').onclick = clearRunStats;

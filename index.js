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
// Types for player/enemy (from PokeAPI)
let playerTypes = [], enemyTypes = [];
// Cache for type data (damage relations)
const typeCache = {};

// Colors for simple type badges
const typeColors = {
    normal: '#A8A77A', fire: '#EE8130', water: '#6390F0', electric:'#F7D02C', grass:'#7AC74C', ice:'#96D9D6',
    fighting:'#C22E28', poison:'#A33EA1', ground:'#E2BF65', flying:'#A98FF3', psychic:'#F95587', bug:'#A6B91A',
    rock:'#B6A136', ghost:'#735797', dragon:'#6F35FC', dark:'#705746', steel:'#B7B7CE', fairy:'#D685AD'
};

function statStageMultiplier(stage) {
    // Pokemon-style stage multipliers: if stage>=0 -> (2+stage)/2, else -> 2/(2-stage)
    if (stage >= 0) return (2 + stage) / 2;
    return 2 / (2 - stage);
}

async function getTypeData(typeName) {
    if (!typeName) return null;
    if (typeCache[typeName]) return typeCache[typeName];
    try {
        const res = await fetch(`https://pokeapi.co/api/v2/type/${typeName}`);
        const data = await res.json();
        typeCache[typeName] = data;
        return data;
    } catch (e) {
        console.warn('Failed to fetch type data for', typeName, e);
        return null;
    }
}

async function getTypeEffectiveness(moveType, defenderTypes) {
    // defenderTypes: array of type names
    if (!moveType || !defenderTypes || defenderTypes.length === 0) return 1;
    const moveTypeData = await getTypeData(moveType);
    if (!moveTypeData || !moveTypeData.damage_relations) return 1;
    let mult = 1;
    const dr = moveTypeData.damage_relations;
    defenderTypes.forEach(dt => {
        if (!dt) return;
        if ((dr.no_damage_to || []).some(t => t.name === dt)) mult *= 0;
        else if ((dr.double_damage_to || []).some(t => t.name === dt)) mult *= 2;
        else if ((dr.half_damage_to || []).some(t => t.name === dt)) mult *= 0.5;
        // Note: using the attacking type's relations (double_damage_to etc.)
    });
    return mult;
}

// --- Core Game Functions ---

// Stat stages (-6..+6) for temporary buffs/debuffs
let playerStatStage = { attack:0, defense:0, 'special-attack':0, 'special-defense':0, speed:0 };
let enemyStatStage = { attack:0, defense:0, 'special-attack':0, 'special-defense':0, speed:0 };

// Expose to window so other runtime code can reference safely
window.playerStatStage = window.playerStatStage || playerStatStage;
window.enemyStatStage = window.enemyStatStage || enemyStatStage;

// Party support: multiple player Pokémon
let playerParty = []; // array of { name, sprite, types, stats..., currentHP, maxHP, moves }
let currentPlayerIndex = 0; // index in playerParty of active Pokémon

function renderTypesUI() {
    // Helper to create badge HTML
    const makeBadges = (types) => {
        if (!Array.isArray(types) || types.length === 0) return '';
        return types.map(t => `<span class="type-badge" style="background:${typeColors[t]||'#666'}; margin-left:6px; padding:2px 6px; border-radius:6px; font-size:11px; text-transform:capitalize;">${t}</span>`).join('');
    };

    // PLAYER: place badges next to level badge (so they appear to the right of the level)
    const playerHeader = document.querySelector('#player-stats .name-header');
    if (playerHeader) {
        const playerNameEl = document.getElementById('player-name');
        const lvlBadge = playerHeader.querySelector('.lvl-badge');
        // Ensure base name is preserved
        const base = playerNameEl.dataset.baseName || (playerNameEl.textContent || '').trim() || 'PLAYER';
        playerNameEl.dataset.baseName = base;
        playerNameEl.innerText = base;
        // Ensure a container for badges exists next to level
        let badgeContainer = playerHeader.querySelector('.type-badges');
        if (!badgeContainer) {
            badgeContainer = document.createElement('span');
            badgeContainer.className = 'type-badges';
            // insert after lvlBadge if present, otherwise append
            if (lvlBadge && lvlBadge.parentNode) lvlBadge.parentNode.insertBefore(badgeContainer, lvlBadge.nextSibling);
            else playerHeader.appendChild(badgeContainer);
        }
        badgeContainer.innerHTML = makeBadges(playerTypes);
    }

    // ENEMY: same behavior — badges next to its level
    const enemyHeader = document.querySelector('#enemy-stats .name-header');
    if (enemyHeader) {
        const enemyNameEl = document.getElementById('enemy-name');
        const lvlBadgeE = enemyHeader.querySelector('.lvl-badge');
        const baseE = enemyNameEl.dataset.baseName || (enemyNameEl.textContent || '').trim() || 'ENEMY';
        enemyNameEl.dataset.baseName = baseE;
        enemyNameEl.innerText = baseE;
        let badgeContainerE = enemyHeader.querySelector('.type-badges');
        if (!badgeContainerE) {
            badgeContainerE = document.createElement('span');
            badgeContainerE.className = 'type-badges';
            if (lvlBadgeE && lvlBadgeE.parentNode) lvlBadgeE.parentNode.insertBefore(badgeContainerE, lvlBadgeE.nextSibling);
            else enemyHeader.appendChild(badgeContainerE);
        }
        badgeContainerE.innerHTML = makeBadges(enemyTypes);
    }
}

async function loadPokemon() {
    try {
        updateMenuButtons(false);
        const enemyID = Math.floor(Math.random() * 151) + 1;
        const enemyRes = await fetch(`https://pokeapi.co/api/v2/pokemon/${enemyID}`);
        const enemyData = await enemyRes.json();

        // Initialize enemy stats from API (scale slightly with enemyLevel set in setEnemyStats)
        const enemyStatsMap = {};
        enemyData.stats.forEach(s => { enemyStatsMap[s.stat.name] = s.base_stat; });
        // Set enemy types
        enemyTypes = enemyData.types.map(t => t.type.name);
        // render type badges after we've set the actual displayed name
        renderTypesUI();
        enemyAttack = Math.max(1, Math.floor((enemyStatsMap['attack'] || 10) * (1 + (enemyLevel - 1) * 0.05)));
        enemyDefense = Math.max(1, Math.floor((enemyStatsMap['defense'] || 10) * (1 + (enemyLevel - 1) * 0.05)));
        enemySpAtk = Math.max(1, Math.floor((enemyStatsMap['special-attack'] || 8) * (1 + (enemyLevel - 1) * 0.04)));
        enemySpDef = Math.max(1, Math.floor((enemyStatsMap['special-defense'] || 8) * (1 + (enemyLevel - 1) * 0.04)));
        enemySpeed = Math.max(1, Math.floor((enemyStatsMap['speed'] || 10) * (1 + (enemyLevel - 1) * 0.03)));

        setEnemyStats();
        enemyStatus = null; // Reset status for new enemy
        // set enemy display name and sprite; ensure dataset.baseName is updated so renderTypesUI won't revert to LOADING
        const enemyNameEl = document.getElementById('enemy-name');
        if (enemyNameEl) { enemyNameEl.dataset.baseName = enemyData.name.toUpperCase(); enemyNameEl.innerText = enemyData.name.toUpperCase(); }
        document.getElementById('enemy-sprite').src = enemyData.sprites.front_default;
        // render type badges after we've set the actual displayed name
        renderTypesUI();

        if (wave === 1) {
            // Only load player and moves if playerMoves empty (preserve PP across waves/level ups)
            if (playerMoves.length === 0) {
                const playerID = Math.floor(Math.random() * 151) + 1;
                const playerRes = await fetch(`https://pokeapi.co/api/v2/pokemon/${playerID}`);
                const playerData = await playerRes.json();
                // Set player types
                playerTypes = playerData.types.map(t => t.type.name);
                // render type badges after we've set the actual displayed name
                renderTypesUI();
                const playerNameEl = document.getElementById('player-name');
                if (playerNameEl) { playerNameEl.dataset.baseName = playerData.name.toUpperCase(); playerNameEl.innerText = playerData.name.toUpperCase(); }
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
        // Apply type effectiveness multiplier
        const moveTypeName = move.type && move.type.name ? move.type.name : null;
        const defenderTypeList = isPlayer ? enemyTypes : playerTypes;
        const typeMult = await getTypeEffectiveness(moveTypeName, defenderTypeList);
        // STAB (same-type attack bonus)
        const attackerTypeList = isPlayer ? playerTypes : enemyTypes;
        const stab = (moveTypeName && attackerTypeList.includes(moveTypeName)) ? 1.5 : 1;
        let finalDamage = Math.max(1, Math.floor(raw * variance * critMultiplier * typeMult * stab));

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
            // Effectiveness message
            if (typeMult > 1) logMessage("It's super effective!");
            else if (typeMult > 0 && typeMult < 1) logMessage("It's not very effective...");
            else if (typeMult === 0) logMessage("It had no effect...");
            if (stab > 1) logMessage('STAB!');
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
            // Effectiveness message
            if (typeMult > 1) logMessage("It's super effective!");
            else if (typeMult > 0 && typeMult < 1) logMessage("It's not very effective...");
            else if (typeMult === 0) logMessage("It had no effect...");
            if (stab > 1) logMessage('STAB!');
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

// Initialize run stats UI and start game after DOM is ready
window.addEventListener('load', () => {
    loadRunStats();
    loadPokemon();
    const clearBtn = document.getElementById('clear-stats-btn');
    if (clearBtn) clearBtn.onclick = () => { clearRunStats(); saveRunStats(); };
    // Periodically persist run stats in case of unexpected exits
    setInterval(saveRunStats, 5000);
    // Ensure stats are saved before page unload
    window.addEventListener('beforeunload', saveRunStats);
});

// Helper: sync active player variables from playerParty[currentPlayerIndex]
function syncActiveFromParty(index) {
    if (!Array.isArray(playerParty) || playerParty.length === 0) return;
    currentPlayerIndex = Math.max(0, Math.min(index, playerParty.length - 1));
    const p = playerParty[currentPlayerIndex];
    // Stats
    playerTypes = p.types || [];
    playerAttack = p.stats.attack || 10;
    playerDefense = p.stats.defense || 10;
    playerSpAtk = p.stats['special-attack'] || 8;
    playerSpDef = p.stats['special-defense'] || 8;
    playerSpeed = p.stats.speed || 10;
    playerMaxHP = p.maxHP || p.stats.hp || 100;
    playerHP = Math.max(0, Math.min(p.currentHP || playerMaxHP, playerMaxHP));
    // Moves
    playerMoves = p.moves || [];
    // Update UI
    const playerNameEl = document.getElementById('player-name');
    if (playerNameEl) { playerNameEl.dataset.baseName = p.name.toUpperCase(); playerNameEl.innerText = p.name.toUpperCase(); }
    const ps = document.getElementById('player-sprite'); if (ps) ps.src = p.sprite || ps.src;
    // Update move buttons
    playerMoves.forEach((move, i) => {
        const btn = document.getElementById(`btn-${i+1}`);
        if (btn) btn.innerText = `${move.name.replace('-', ' ').toUpperCase()} (PP ${move.currentPP || move.pp || 0}/${move.pp || 5})`;
    });
    updateHPBar('player-hp-fill', (playerHP / playerMaxHP) * 100);
    renderTypesUI();
}

function openPartyScreen() {
    renderPartyScreen();
    document.getElementById('party-screen').style.display = 'flex';
}
function closePartyScreen() { document.getElementById('party-screen').style.display = 'none'; }

function renderPartyScreen() {
    const list = document.getElementById('party-list');
    list.innerHTML = '';
    playerParty.forEach((p, idx) => {
        const el = document.createElement('div');
        el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.gap = '8px'; el.style.marginBottom = '8px';
        el.innerHTML = `
            <img src="${p.sprite||''}" style="width:48px;height:48px;image-rendering:pixelated;border:2px solid #222;"/>
            <div style="flex:1;text-align:left;">
                <div style="font-weight:700">${p.name.toUpperCase()} <small style='margin-left:6px'>Lv.${p.level||playerLevel}</small></div>
                <div style="font-size:12px;color:#ddd">HP: ${p.currentHP}/${p.maxHP}</div>
            </div>
        `;
        const btn = document.createElement('button');
        btn.className = 'item-btn';
        btn.innerText = (idx === currentPlayerIndex) ? 'Active' : (p.currentHP > 0 ? 'Switch' : 'Fainted');
        btn.disabled = (idx === currentPlayerIndex) || (p.currentHP <= 0);
        btn.onclick = () => { switchTo(idx); };
        el.appendChild(btn);
        list.appendChild(el);
    });
}

// Switch to a party member (consumes player's turn)
function switchTo(index) {
    if (!isPlayerTurn) return; // can only switch on player's turn
    if (index === currentPlayerIndex) return;
    if (!playerParty[index] || playerParty[index].currentHP <= 0) return;
    logMessage(`You sent out ${playerParty[index].name.toUpperCase()}!`);
    // Sync active and close UI
    syncActiveFromParty(index);
    closePartyScreen();
    // End player's turn and let enemy act
    isPlayerTurn = false;
    updateMenuButtons(false);
    setTimeout(async () => {
        await executeMove('enemy', 0);
        if (playerHP > 0) {
            applyStatusDamage('player');
            setTimeout(() => { isPlayerTurn = true; updateMenuButtons(true); }, 800);
        }
    }, 800);
}

// Auto-switch when active Pokemon faints; returns true if switched, false if no available Pokemon
function autoSwitchIfFainted() {
    const aliveIdx = playerParty.findIndex(p => p.currentHP > 0);
    if (aliveIdx >= 0) {
        logMessage(`${playerParty[currentPlayerIndex].name.toUpperCase()} fainted! Switching to ${playerParty[aliveIdx].name.toUpperCase()}...`);
        syncActiveFromParty(aliveIdx);
        return true;
    }
    return false;
}

require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle
} = require('discord.js');

const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, set, runTransaction } = require('firebase/database');

const firebaseConfig = {
    databaseURL: process.env.FIREBASE_DB_URL
};
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const DEV_ID = process.env.DEV_ID;

// Helper: Data Default User
function getDefaultUserData(userObject = null) {
    return {
        username: userObject ? userObject.username : "Unknown",
        coins: 1000, 
        inventory: [],
        equipment: { weapon: null, armor: null, helm: null, boots: null },
        floor: 1,
        lastFloor: 1,
        lastHunt: 0,
        currentHp: 100,
        level: 1,
        exp: 0,
        maxExp: 100,
        statPoints: 0,
        stats: { str: 0, agi: 0, vit: 0 },
        pet: null,
        location: "CITY",
        activeCombat: null
    };
}

// Normalisasi lokasi lama agar data Firebase versi sebelumnya tetap kompatibel.
function normalizeLocation(value, floor = 1) {
    const raw = String(value ?? '').trim().toUpperCase().replace(/[ _-]+/g, '');
    if (['CITY', 'TOWN', 'KOTA'].includes(raw)) return 'CITY';
    if (['SAFEZONE', 'SAFEAREA', 'ZONESAFE'].includes(raw)) return 'SAFEZONE';
    if (['DUNGEON', 'DUNGEONFLOOR', 'DUNGEONROOM'].includes(raw)) return 'DUNGEON';
    return Number(floor) > 1 ? 'DUNGEON' : 'CITY';
}

// Wrapper diagnostik transaksi: membedakan pembatalan logika dari error Firebase.
async function runLoggedTransaction(label, databaseRef, updater) {
    try {
        const result = await runTransaction(databaseRef, (currentData) => {
            console.log(`[TX:${label}] callback`, {
                exists: currentData !== null && currentData !== undefined,
                location: currentData?.location,
                coins: currentData?.coins,
                activeCombat: Boolean(currentData?.activeCombat)
            });
            return updater(currentData);
        });
        console.log(`[TX:${label}] result`, {
            committed: result.committed,
            snapshotExists: result.snapshot ? result.snapshot.exists() : false,
            location: result.snapshot ? result.snapshot.child('location').val() : null,
            coins: result.snapshot ? result.snapshot.child('coins').val() : null
        });
        return result;
    } catch (error) {
        console.error(`[TX:${label}] Firebase exception`, error?.code || '', error?.message || error);
        throw error;
    }
}

// Helper: Ambil / Inisialisasi Data User Aman dengan Normalisasi Skema Legacy
async function getUser(userId, userObject = null) {
    try {
        const userRef = ref(database, `users/${userId}`);
        const snapshot = await get(userRef);

        if (!snapshot.exists()) {
            const defaultData = getDefaultUserData(userObject);
            await set(userRef, defaultData);
            return defaultData;
        }

        const userData = snapshot.val();
        if (userObject && userObject.username && userData.username !== userObject.username) {
            userData.username = userObject.username;
            await set(userRef, userData);
        }

        if (!Array.isArray(userData.inventory)) userData.inventory = [];
        const inventoryBeforeMaterialCleanup = userData.inventory.length;
        userData.inventory = userData.inventory.filter(item => item.type !== 'material');
        if (userData.inventory.length !== inventoryBeforeMaterialCleanup) {
            await set(userRef, userData);
        }
        userData.inventory.forEach(item => {
            if (item.quantity === undefined || isNaN(item.quantity)) item.quantity = 1;
            if (item.durability !== undefined && (isNaN(item.durability) || item.durability < 0)) item.durability = item.maxDurability || 50;
        });

        if (typeof userData.coins !== 'number' || isNaN(userData.coins)) userData.coins = 0;
        if (typeof userData.currentHp !== 'number' || isNaN(userData.currentHp)) userData.currentHp = 100;
        if (typeof userData.level !== 'number' || isNaN(userData.level)) userData.level = 1;
        if (typeof userData.exp !== 'number' || isNaN(userData.exp)) userData.exp = 0;
        if (typeof userData.maxExp !== 'number' || isNaN(userData.maxExp)) userData.maxExp = 100;
        if (typeof userData.statPoints !== 'number' || isNaN(userData.statPoints)) userData.statPoints = 0;
        
        if (!userData.stats || typeof userData.stats !== 'object') userData.stats = { str: 0, agi: 0, vit: 0 };
        if (typeof userData.stats.str !== 'number' || isNaN(userData.stats.str)) userData.stats.str = 0;
        if (typeof userData.stats.agi !== 'number' || isNaN(userData.stats.agi)) userData.stats.agi = 0;
        if (typeof userData.stats.vit !== 'number' || isNaN(userData.stats.vit)) userData.stats.vit = 0;

        if (!userData.equipment || typeof userData.equipment !== 'object') userData.equipment = { weapon: null, armor: null, helm: null, boots: null };
        if (userData.pet === undefined) userData.pet = null;
        if (typeof userData.floor !== 'number' || userData.floor < 1) userData.floor = 1;
        if (typeof userData.lastFloor !== 'number' || userData.lastFloor < 1) userData.lastFloor = userData.floor;
        if (typeof userData.lastHunt !== 'number') userData.lastHunt = 0;

        userData.location = normalizeLocation(userData.location, userData.floor);
        if (userData.activeCombat === undefined) userData.activeCombat = null;

        return userData;
    } catch (error) {
        console.error("Database Error (getUser):", error);
        throw error;
    }
}

async function saveUser(userId, userData) {
    try {
        const userRef = ref(database, `users/${userId}`);
        await set(userRef, userData);
    } catch (error) {
        console.error("Database Error (saveUser):", error);
        throw new Error("Gagal menyimpan data ke database.");
    }
}

function getMaxInventorySlots(level) {
    return 15 + ((level - 1) * 3);
}

function isIdExists(user, id) {
    if (user.inventory) {
        const inInv = user.inventory.some(item => item.id === id);
        if (inInv) return true;
    }
    if (user.equipment) {
        for (const slot in user.equipment) {
            if (user.equipment[slot] && user.equipment[slot].id === id) return true;
        }
    }
    return false;
}

function generateUniqueItemId(user) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let newId;
    do {
        let result = '';
        for (let i = 0; i < 4; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        newId = `ITM-${result}`;
    } while (isIdExists(user, newId));
    return newId;
}

function cleanName(str) {
    if (!str) return "";
    return str.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF\u001A]/g, '')
              .replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '')
              .trim()
              .toLowerCase();
}

function isValidInteger(str) {
    return /^\d+$/.test(str);
}

const ITEMS = {
    ALL_ITEMS: [
        { name: "Wolf Pup Pet 🐺", type: "pet", bonus: { atk: 10 }, rarity: "Rare", value: 2000, buyPrice: 3500 },
        { name: "Iron Golem Pet 🤖", type: "pet", bonus: { def: 15 }, rarity: "Epic", value: 5000, buyPrice: 8000 },

        { name: "Wooden Sword 🪵", type: "weapon", stats: { atk: 5 }, rarity: "Common", value: 100, durability: 50 },
        { name: "Wooden Helmet 🪖", type: "helm", stats: { def: 3 }, rarity: "Common", value: 80, durability: 50 },
        { name: "Wooden Boots 🥾", type: "boots", stats: { def: 2, speed: 1 }, rarity: "Common", value: 50, durability: 50 },
        { name: "Wooden Chestplate 🧥", type: "armor", stats: { def: 8, speed: 1 }, rarity: "Common", value: 150, durability: 50 },
        
        { name: "Stone Sword 🪨", type: "weapon", stats: { atk: 10 }, rarity: "Uncommon", value: 300, durability: 75 },
        { name: "Stone Helmet 🪨", type: "helm", stats: { def: 6 }, rarity: "Uncommon", value: 250, durability: 75 },
        { name: "Stone Boots 🪨", type: "boots", stats: { def: 4, speed: 2 }, rarity: "Uncommon", value: 200, durability: 75 },
        { name: "Stone Chestplate 🪨", type: "armor", stats: { def: 14 }, rarity: "Uncommon", value: 450, durability: 75 },

        { name: "Grilled Fish 🐟", type: "consumable", stats: { hp: 25 }, rarity: "Common", value: 120, buyPrice: 200 },
        { name: "Grilled Chicken 🍗", type: "consumable", stats: { hp: 40 }, rarity: "Common", value: 220, buyPrice: 350 },
        { name: "Golden Apple 🍎", type: "consumable", stats: { hp: 50 }, rarity: "Common", value: 300, buyPrice: 500 },
        { name: "Steak 🥩", type: "consumable", stats: { hp: 75 }, rarity: "Rare", value: 450, buyPrice: 750 },
        { name: "Ancient Return Scroll 📜", type: "consumable", effect: "return_scroll", rarity: "Mythic", value: 100000, buyPrice: 100000 },

        { name: "Iron Sword 🗡️", type: "weapon", stats: { atk: 15 }, rarity: "Rare", value: 1000, durability: 100 },
        { name: "Iron Helmet ⛑️", type: "helm", stats: { def: 10 }, rarity: "Rare", value: 800, durability: 100 },
        { name: "Iron Boots 🥾", type: "boots", stats: { def: 8, speed: 1 }, rarity: "Rare", value: 700, durability: 100 },
        { name: "Iron Chestplate 🛡️", type: "armor", stats: { def: 20 }, rarity: "Rare", value: 1500, durability: 100 },

        { name: "Golden Sword ⚔️", type: "weapon", stats: { atk: 25 }, rarity: "Epic", value: 7500, durability: 150 },
        { name: "Golden Helmet 👑", type: "helm", stats: { def: 18 }, rarity: "Epic", value: 6000, durability: 150 },
        { name: "Golden Boots 👢", type: "boots", stats: { def: 15, speed: 4 }, rarity: "Epic", value: 5000, durability: 150 },
        { name: "Golden Chestplate 🛡️", type: "armor", stats: { def: 35 }, rarity: "Epic", value: 10000, durability: 150 },

        { name: "Diamond Sword 💎", type: "weapon", stats: { atk: 50 }, rarity: "Legendary", value: 25000, durability: 250 },
        { name: "Diamond Helmet 💠", type: "helm", stats: { def: 30 }, rarity: "Legendary", value: 20000, durability: 250 },
        { name: "Diamond Boots 🛼", type: "boots", stats: { def: 25, speed: 6 }, rarity: "Legendary", value: 15000, durability: 250 },
        { name: "Diamond Chestplate 🔷", type: "armor", stats: { def: 60 }, rarity: "Legendary", value: 40000, durability: 250 }
    ]
};

const BOSS_LIST = {
    10: { name: "Zombie Giant 🧟", hp: 150, atk: 25 },
    20: { name: "Cave Spider Queen 🕷️", hp: 300, atk: 45 },
    30: { name: "Blaze Commander 🔥", hp: 550, atk: 75 },
    40: { name: "Wither Skeleton King 💀", hp: 900, atk: 110 },
    50: { name: "Ender Dragon Avatar 🐉", hp: 1500, atk: 160 },
    60: { name: "Abyssal Devourer 👹", hp: 2200, atk: 210 },
    70: { name: "Dreadlord of the Void ☠️", hp: 3200, atk: 270 },
    80: { name: "Bloodmoon Behemoth 🩸", hp: 4600, atk: 340 },
    90: { name: "The Nameless Terror 👁️", hp: 6500, atk: 430 },
    100: { name: "Apocalypse Dragon, World-Ender 🐉☠️", hp: 9000, atk: 550 }
};

function getItemData(itemName) {
    const target = cleanName(itemName);
    return ITEMS.ALL_ITEMS.find(i => cleanName(i.name) === target);
}

function createItemInstance(user, itemTemplate) {
    const clone = JSON.parse(JSON.stringify(itemTemplate));
    clone.name = clone.name.trim(); 
    if (clone.type === 'consumable' || clone.type === 'material' || clone.type === 'pet') {
        clone.quantity = 1;
        return clone;
    }
    clone.id = generateUniqueItemId(user);
    clone.maxDurability = clone.durability || 50;
    clone.durability = clone.maxDurability;
    return clone;
}

function addConsumableMaterialOrPetToInventory(user, itemTemplate, qty = 1) {
    if (!Array.isArray(user.inventory)) user.inventory = [];
    const inventory = user.inventory;
    const cleanedTarget = cleanName(itemTemplate.name);
    const existingIndex = inventory.findIndex(i => (i.type === 'consumable' || i.type === 'material' || i.type === 'pet') && cleanName(i.name) === cleanedTarget);
    
    if (existingIndex !== -1) {
        inventory[existingIndex].quantity = (inventory[existingIndex].quantity || 1) + qty;
        return true;
    } else {
        const maxSlots = getMaxInventorySlots(user.level || 1);
        if (inventory.length >= maxSlots) return false;

        const newItem = createItemInstance(user, itemTemplate);
        newItem.quantity = qty;
        inventory.push(newItem);
        return true;
    }
}

function addGearOrUniqueToInventory(user, itemInstance) {
    if (!Array.isArray(user.inventory)) user.inventory = [];
    const inventory = user.inventory;
    const maxSlots = getMaxInventorySlots(user.level || 1);
    if (inventory.length >= maxSlots) return false;

    inventory.push(itemInstance);
    return true;
}

function getRandomDrop(user) {
    const rand = Math.random();
    let pool = [];
    if (rand < 0.025) pool = ITEMS.ALL_ITEMS.filter(i => i.rarity === 'Legendary');
    else if (rand < 0.075) pool = ITEMS.ALL_ITEMS.filter(i => i.rarity === 'Epic');
    else if (rand < 0.175) pool = ITEMS.ALL_ITEMS.filter(i => i.rarity === 'Rare');
    else if (rand < 0.475) pool = ITEMS.ALL_ITEMS.filter(i => i.rarity === 'Uncommon');
    else pool = ITEMS.ALL_ITEMS.filter(i => i.rarity === 'Common' && i.type !== 'pet');

    const template = pool[Math.floor(Math.random() * pool.length)];
    return createItemInstance(user, template);
}

function rollGacha(user) {
    const rand = Math.random();
    let pool = [];
    if (rand < 0.025) pool = ITEMS.ALL_ITEMS.filter(i => i.rarity === 'Legendary');
    else if (rand < 0.075) pool = ITEMS.ALL_ITEMS.filter(i => i.rarity === 'Epic');
    else if (rand < 0.175) pool = ITEMS.ALL_ITEMS.filter(i => i.rarity === 'Rare');
    else if (rand < 0.475) pool = ITEMS.ALL_ITEMS.filter(i => i.rarity === 'Uncommon');
    else pool = ITEMS.ALL_ITEMS.filter(i => i.rarity === 'Common' && i.type !== 'pet');

    const template = pool[Math.floor(Math.random() * pool.length)];
    return createItemInstance(user, template);
}

function calculatePlayerStats(user) {
    let atk = 10 + ((user.stats?.str || 0) * 3);
    let def = 5 + ((user.stats?.agi || 0) * 2);
    let hp = 100 + ((user.stats?.vit || 0) * 20);
    let speed = 5 + ((user.stats?.agi || 0));

    if (user.pet && user.pet.bonus) {
        if (user.pet.bonus.atk) atk += user.pet.bonus.atk;
        if (user.pet.bonus.def) def += user.pet.bonus.def;
    }

    if (user.equipment) {
        for (const slot in user.equipment) {
            const equippedItem = user.equipment[slot];
            if (equippedItem && equippedItem.stats && (equippedItem.durability === undefined || equippedItem.durability > 0)) {
                if (equippedItem.stats.atk) atk += equippedItem.stats.atk;
                if (equippedItem.stats.def) def += equippedItem.stats.def;
                if (equippedItem.stats.speed) speed += equippedItem.stats.speed;
            }
        }
    }
    return { atk, def, hp, speed };
}

function processEquipmentDurability(user) {
    let logs = [];
    if (user.equipment) {
        for (const slot in user.equipment) {
            const item = user.equipment[slot];
            if (item && item.durability !== undefined) {
                const loss = Math.floor(Math.random() * 3) + 1;
                item.durability = Math.max(0, item.durability - loss);

                if (item.durability <= 0) {
                    logs.push(`💥 **[HANCUR PERMANEN]** Gear **${item.name}** hancur!`);
                    user.equipment[slot] = null;
                } else {
                    const percentage = (item.durability / item.maxDurability) * 100;
                    const previousPercentage = ((item.durability + loss) / item.maxDurability) * 100;
                    if (percentage <= 10 && previousPercentage > 10) {
                        logs.push(`⚠️ **[DURABILITY RENDAH]** Gear **${item.name}** tersisa ${Math.round(percentage)}%! Segera gunakan \`!repair\` atau ganti gear.`);
                    }
                }
            }
        }
    }
    return logs;
}

client.once('ready', () => {
    console.log(`🤖 Adventure Time Bot Enterprise Ultimate Edition Loaded! Login: ${client.user.tag}`);
});

const commandCooldowns = new Map();
const COMMAND_DELAY_MS = 1500;
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith('!')) return;

    try {
        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        const userId = message.author.id;
        const nowForThrottle = Date.now();
        const lastCommandAt = commandCooldowns.get(userId) || 0;
        if (nowForThrottle - lastCommandAt < COMMAND_DELAY_MS) {
            const remaining = Math.ceil((COMMAND_DELAY_MS - (nowForThrottle - lastCommandAt)) / 1000);
            return message.reply(`⏳ Beri jeda sebentar sebelum command berikutnya (${remaining} detik).`).catch(() => {});
        }
        commandCooldowns.set(userId, nowForThrottle);

        if (command === 'start') {
            const user = await getUser(userId, message.author);
            const welcomeEmbed = new EmbedBuilder()
                .setTitle("🎉 Selamat Datang di Adventure Time Bot!")
                .setDescription(`Halo **${message.author.username}**, akun RPG kamu aktif!\n\n• Koin: **${user.coins.toLocaleString()} 🪙**\n• Lokasi: **Kota (Town)**\n\nKetik \`!menu\` untuk memulai petualangan!`)
                .setColor(0x2ECC71);

            return message.reply({ embeds: [welcomeEmbed] });
        }

        const user = await getUser(userId, message.author);
        const maxSlots = getMaxInventorySlots(user.level);

        if (command === 'menu' || command === 'help') {
            const menuEmbed = new EmbedBuilder()
                .setTitle("🗺️ Adventure Time Bot - RPG & Survival")
                .setDescription(`🎒 **Kapasitas Tas:** ${user.inventory.length}/${maxSlots} Slot`)
                .addFields(
                    { name: "📊 Karakter & Level", value: "`!profile` | `!allocate` | `!inv`", inline: false },
                    { name: "🛒 Perdagangan & Toko", value: "`!market` | `!buy` | `!sell`", inline: false },
                    { name: "🛡️ Equipment & Pet", value: "`!repair` | `!equip` | `!unequip` | `!summon` | `!dismiss`", inline: false },
                    { name: "⚔️ Dungeon & Kasino", value: "`!dungeon` | `!hunt` | `!eat` (Safe Zone) | `!teleport` | `!infohunt` | `!leave` | `!gacha` | `!slot`", inline: false },
                    { name: "📜 Progres Dungeon", value: "Beli `Ancient Return Scroll` di `!market`, lalu gunakan `!teleport` di Kota untuk kembali ke lantai terakhir.", inline: false }
                )
                .setColor(0x3498DB);

            return message.reply({ embeds: [menuEmbed] });
        }

        if (command === 'dungeon') {
            if (user.activeCombat) {
                return message.reply("⚔️ Kamu masih berada dalam pertarungan. Jalankan `!hunt` untuk melanjutkan pertarungan.");
            }
            if (user.location !== "CITY") {
                return message.reply(user.location === "SAFEZONE"
                    ? "🟢 Kamu sedang berada di Safe Zone. Gunakan `!hunt` untuk melanjutkan ke lantai berikutnya, atau tombol Safe Zone untuk pulang."
                    : `⚔️ Kamu sudah berada di Dungeon lantai **${user.floor}**. Jalankan \`!hunt\` untuk bertarung.`);
            }

            const hasCheckpoint = Number(user.lastFloor || 1) > 1;
            if (hasCheckpoint) {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`dn_reset_${userId}`).setLabel('🆕 Mulai dari Lantai 1').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId(`dn_keep_${userId}`).setLabel('Batal').setStyle(ButtonStyle.Secondary)
                );
                return message.reply({
                    content: `🏰 **Kamu berada di Kota (Town).**\nUntuk masuk dungeon, jalankan \`!dungeon\`.\n\n⚠️ Data checkpoint menunjukkan progres sampai lantai **${user.lastFloor}**. Jika memilih **Mulai dari Lantai 1**, checkpoint lama akan ditimpa menjadi lantai 1. Lanjutkan?`,
                    components: [row]
                });
            }

            const enterResult = await runLoggedTransaction("DUNGEON_ENTER", ref(database, `users/${userId}`), (data) => {
                if (!data) {
                    data = getDefaultUserData(message.author);
                }
                data.location = normalizeLocation(data.location, data.floor);
                if (data.location !== "CITY" || data.activeCombat) return data;
                data.floor = 1;
                data.lastFloor = 1;
                data.location = "DUNGEON";
                data.activeCombat = null;
                return data;
            });

            if (!enterResult.committed) { 
                console.warn(`[DUNGEON_ENTER] aborted for user ${userId}; check [TX:DUNGEON_ENTER] callback logs above.`); 
                return message.reply("❌ Gagal masuk dungeon. Cek log transaksi di console."); 
            }
            return message.reply("🚪 **Kamu masuk ke Dungeon!** Kamu mulai dari **Lantai 1**. Jalankan `!hunt` untuk memulai pertarungan.");
        }

        if (command === 'infohunt') {
            let locName = "🏰 Kota (Town)";
            if (user.location === "SAFEZONE") locName = `🟢 Safe Zone (Lantai ${user.floor})`;
            else if (user.location === "DUNGEON") locName = `⚔️ Dungeon (Lantai ${user.floor})`;

            const embed = new EmbedBuilder()
                .setTitle(`🗺️ Informasi Posisi: ${message.author.username}`)
                .setDescription(`• **Lokasi:** **${locName}**\n• **Level:** ${user.level} (EXP: ${user.exp}/${user.maxExp})\n• **Kapasitas Tas:** ${user.inventory.length}/${maxSlots} Slot`)
                .setColor(0x9B59B6);

            return message.reply({ embeds: [embed] });
        }

        if (command === 'profile' || command === 'stats') {
            const stats = calculatePlayerStats(user);
            if (user.currentHp > stats.hp) {
                user.currentHp = stats.hp;
                await saveUser(userId, user);
            }

            let locDesc = "🏰 Kota";
            if (user.location === "SAFEZONE") locDesc = `🟢 Safe Zone (Lantai ${user.floor})`;
            else if (user.location === "DUNGEON") locDesc = `⚔️ Dungeon (Lantai ${user.floor})`;

            const embed = new EmbedBuilder()
                .setTitle(`⛏️ RPG Stats: ${message.author.username}`)
                .addFields(
                    { name: "📍 Lokasi", value: locDesc, inline: true },
                    { name: "⭐ Level & Tas", value: `Level **${user.level}** | Tas: **${user.inventory.length}/${maxSlots}**`, inline: true },
                    { name: "💰 Koin", value: `${user.coins.toLocaleString('id-ID')} 🪙`, inline: true },
                    { name: "❤️ HP Karakter", value: `**${user.currentHp} /${stats.hp}**`, inline: true },
                    { name: "🐾 Pet Aktif", value: user.pet ? `**${user.pet.name}**` : "*Tidak ada*", inline: true },
                    { name: "📊 Atribut", value: `• STR: **${user.stats.str}** | AGI: **${user.stats.agi}** | VIT: **${user.stats.vit}**\n🌟 **Stat Points:** **${user.statPoints}**`, inline: false },
                    { name: "⚔️ Combat Stats", value: `• ATK: **${stats.atk}** | DEF: **${stats.def}** | Speed Dungeon: **${stats.speed}**`, inline: false }
                )
                .setColor(0x3498DB);

            return message.reply({ embeds: [embed] });
        }

        if (command === 'allocate') {
            const statType = args[0] ? args[0].toLowerCase() : null;
            if (!['str', 'agi', 'vit'].includes(statType)) {
                return message.reply("❌ Pilih stat yang valid: `str`, `agi`, atau `vit`.");
            }
            if (!isValidInteger(args[1])) {
                return message.reply("❌ Masukkan jumlah angka bulat yang valid!");
            }
            const amount = parseInt(args[1], 10);

            const userRef = ref(database, `users/${userId}`);
            const allocationResult = await runTransaction(userRef, (currentData) => {
                if (!currentData) currentData = getDefaultUserData(message.author);
                if (amount <= 0 || (currentData.statPoints || 0) < amount) return;
                currentData.statPoints -= amount;
                if (!currentData.stats) currentData.stats = { str: 0, agi: 0, vit: 0 };
                currentData.stats[statType] = (currentData.stats[statType] || 0) + amount;
                return currentData;
            });

            if (!allocationResult.committed) {
                return message.reply("❌ Gagal mengalokasikan stat (poin tidak cukup atau konflik data).");
            }
            return message.reply(`✅ Berhasil mengalokasikan **+${amount}** ke stat **${statType.toUpperCase()}**!`);
        }

        if (command === 'market') {
            const marketEmbed = new EmbedBuilder()
                .setTitle("🛒 MARKETPLACE & PET SHOP KOTA")
                .setDescription("🐺 **Wolf Pup Pet 🐺** ➔ **3.500 Koin**\n" +
                    "🤖 **Iron Golem Pet 🤖** ➔ **8.000 Koin**\n" +
                    "🐟 **Grilled Fish 🐟** (HP +25) ➔ **200 Koin**\n" +
                    "🍗 **Grilled Chicken 🍗** (HP +40) ➔ **350 Koin**\n" +
                    "🍎 **Golden Apple 🍎** (HP +50) ➔ **500 Koin**\n" +
                    "🥩 **Steak 🥩** (HP +75) ➔ **750 Koin**\n\n" +
                    "📜 **Ancient Return Scroll** ➔ **100.000 Koin** (teleport ke progres dungeon terakhir)")
                .setColor(0x2ECC71);

            return message.reply({ embeds: [marketEmbed] });
        }

        if (command === 'buy') {
            if (user.location !== "CITY") return message.reply("⛔ Berbelanja hanya di **Kota (Town)**.");

            let qty = 1;
            const lastArg = args[args.length - 1];
            if (isValidInteger(lastArg)) {
                qty = parseInt(lastArg, 10);
                args.pop();
            }
            if (qty <= 0 || qty > 99) return message.reply("❌ Jumlah pembelian tidak valid (1–99)!");

            const itemName = args.join(" ");
            const template = getItemData(itemName);
            if (!template || !template.buyPrice) return message.reply("❌ Item tidak tersedia di market!");

            const totalPrice = template.buyPrice * qty;

            const userRef = ref(database, `users/${userId}`);
            let failReason = "";
            const buyResult = await runLoggedTransaction("BUY", userRef, (currentData) => {
                if (!currentData) currentData = getDefaultUserData(message.author);
                if ((currentData.coins || 0) < totalPrice) {
                    failReason = `Koin tidak cukup! Butuh **${totalPrice.toLocaleString()} Koin**.`;
                    return;
                }
                if (!Array.isArray(currentData.inventory)) currentData.inventory = [];
                const maxS = getMaxInventorySlots(currentData.level || 1);
                
                const cleanedTarget = cleanName(template.name);
                const existingIndex = currentData.inventory.findIndex(i => (i.type === 'consumable' || i.type === 'material' || i.type === 'pet') && cleanName(i.name) === cleanedTarget);
                
                if (existingIndex !== -1) {
                    currentData.inventory[existingIndex].quantity = (currentData.inventory[existingIndex].quantity || 1) + qty;
                } else {
                    if (currentData.inventory.length >= maxS) {
                        failReason = `Inventory Penuh! Batas maksimal **${maxS} Slot**.`;
                        return;
                    }
                    const newItem = JSON.parse(JSON.stringify(template));
                    newItem.name = newItem.name.trim();
                    if (newItem.type === 'consumable' || newItem.type === 'material' || newItem.type === 'pet') {
                        newItem.quantity = qty;
                    } else {
                        newItem.id = generateUniqueItemId(currentData);
                        newItem.maxDurability = newItem.durability || 50;
                        newItem.durability = newItem.maxDurability;
                    }
                    currentData.inventory.push(newItem);
                }

                currentData.coins -= totalPrice;
                return currentData;
            });

            if (!buyResult.committed) {
                console.warn(`[BUY] transaction not committed for user ${userId}; reason=${failReason || "no business-validation reason"}`);
                return message.reply(`❌ ${failReason || "Transaksi pembelian dibatalkan. Periksa log [TX:BUY] di console."}`);
            }

            return message.reply(`✅ Berhasil membeli **${qty}x ${template.name}** seharga **${totalPrice.toLocaleString()} Koin**!`);
        }

        if (command === 'sell') {
            if (user.location !== "CITY") return message.reply("⛔ Menjual item hanya di **Kota (Town)**.");

            let sellQty = null;
            const lastArg = args[args.length - 1];
            if (isValidInteger(lastArg)) {
                sellQty = parseInt(lastArg, 10);
                args.pop();
            }

            const targetArg = args.join(" ").toUpperCase();
            if (!targetArg) return message.reply("❌ Masukkan ID Gear atau Nama Item yang ingin dijual!");

            const userRef = ref(database, `users/${userId}`);
            let sellMsg = "";
            const sellResult = await runTransaction(userRef, (currentData) => {
                if (!currentData) currentData = getDefaultUserData(message.author);
                if (!Array.isArray(currentData.inventory)) currentData.inventory = [];
                
                let idx = currentData.inventory.findIndex(i => i.id && i.id.toUpperCase() === targetArg);
                if (idx !== -1) {
                    const itemToSell = currentData.inventory[idx];
                    if (currentData.equipment) {
                        for (const s in currentData.equipment) {
                            if (currentData.equipment[s] && currentData.equipment[s].id === itemToSell.id) {
                                sellMsg = "❌ Tidak bisa menjual gear yang sedang dipakai!";
                                return;
                            }
                        }
                    }
                    const val = itemToSell.value || 100;
                    currentData.inventory.splice(idx, 1);
                    currentData.coins = (currentData.coins || 0) + val;
                    sellMsg = `✅ Berhasil menjual gear **${itemToSell.name}** seharga **+${val.toLocaleString()} Koin**!`;
                    return currentData;
                } else {
                    const cleanedTarget = cleanName(targetArg);
                    idx = currentData.inventory.findIndex(i => cleanName(i.name) === cleanedTarget);
                    if (idx !== -1) {
                        const itemToSell = currentData.inventory[idx];
                        if (['material', 'consumable', 'pet'].includes(itemToSell.type)) {
                            const currentQty = itemToSell.quantity || 1;
                            const qtyToSell = sellQty !== null ? Math.min(sellQty, currentQty) : currentQty;
                            if (qtyToSell <= 0) {
                                sellMsg = "❌ Jumlah penjualan tidak valid!";
                                return;
                            }
                            const unitVal = itemToSell.value || 50;
                            const totalVal = unitVal * qtyToSell;

                            itemToSell.quantity = (itemToSell.quantity || 1) - qtyToSell;
                            const remainingQty = itemToSell.quantity;
                            if (itemToSell.quantity <= 0) {
                                currentData.inventory.splice(idx, 1);
                            }
                            currentData.coins = (currentData.coins || 0) + totalVal;
                            sellMsg = `✅ Berhasil menjual **${qtyToSell}x ${itemToSell.name}** seharga **+${totalVal.toLocaleString()} Koin**! (Sisa di tas: ${remainingQty > 0 ? remainingQty : 0})`;
                            return currentData;
                        } else {
                            const val = itemToSell.value || 100;
                            currentData.inventory.splice(idx, 1);
                            currentData.coins = (currentData.coins || 0) + val;
                            sellMsg = `✅ Berhasil menjual gear **${itemToSell.name}** seharga **+${val.toLocaleString()} Koin**!`;
                            return currentData;
                        }
                    }
                }
                sellMsg = `❌ Item **"${targetArg}"** tidak ditemukan di tas kamu!`;
            });

            if (!sellResult.committed && !sellMsg.startsWith('❌')) sellMsg = '❌ Penjualan gagal karena data berubah atau item tidak tersedia. Coba lagi.';
            return message.reply(sellMsg || '❌ Penjualan gagal.');
        }

        if (command === 'gacha') {
            if (user.location !== "CITY") return message.reply("⛔ Gacha hanya di **Kota (Town)**.");

            const GACHA_PRICE = 500;
            let count = 1;
            if (args[0]) {
                if (!isValidInteger(args[0])) return message.reply("❌ Jumlah gacha tidak valid!");
                count = parseInt(args[0], 10);
            }
            if (count < 1 || count > 5) return message.reply("❌ Maksimal 5x gacha sekaligus!");

            const totalCost = count * GACHA_PRICE;
            if (user.coins < totalCost) return message.reply(`❌ Koin tidak cukup! Butuh **${totalCost.toLocaleString()} Koin**.`);

            const userRef = ref(database, `users/${userId}`);
            let results = [];
            let failMsg = "";
            const gachaResult = await runTransaction(userRef, (currentData) => {
                if (!currentData) currentData = getDefaultUserData(message.author);
                if ((currentData.coins || 0) < totalCost) {
                    failMsg = "Koin tidak cukup!";
                    return;
                }
                const inv = currentData.inventory || [];
                const dummyUser = { inventory: inv, level: currentData.level || 1 };

                const rolled = [];
                for (let i = 0; i < count; i++) {
                    const item = rollGacha(dummyUser);
                    let added = false;
                    if (item.type === 'consumable' || item.type === 'material' || item.type === 'pet') {
                        added = addConsumableMaterialOrPetToInventory(dummyUser, item, 1);
                    } else {
                        added = addGearOrUniqueToInventory(dummyUser, item);
                    }
                    if (!added) {
                        failMsg = "Inventory Tidak Cukup untuk menampung hasil gacha!";
                        return;
                    }
                    rolled.push(item);
                }

                currentData.coins -= totalCost;
                currentData.inventory = dummyUser.inventory;
                results = rolled;
                return currentData;
            });

            if (!gachaResult.committed) {
                return message.reply(`❌ ${failMsg || "Gagal memproses gacha."}`);
            }

            const list = results.map((i, idx) => `**${idx + 1}.** **${i.name}** *[${i.rarity}]*`).join('\n');
            return message.reply({ embeds: [new EmbedBuilder().setTitle(`🎰 Gacha Terbuka (${count}x)!`).setDescription(list).setColor(0xF1C40F)] });
        }

        if (command === 'slot') {
            if (user.location !== "CITY") return message.reply("⛔ Mesin slot hanya di **Kota**.");
            if (!isValidInteger(args[0])) return message.reply("❌ Taruhan harus berupa angka bulat yang valid!");
            const bet = parseInt(args[0], 10);
            if (bet <= 0 || bet > 50000) {
                return message.reply("❌ Taruhan tidak valid atau melebihi batas maksimal (50.000 Koin)!");
            }

            const userRef = ref(database, `users/${userId}`);
            let payout = 0;
            let s1 = '', s2 = '', s3 = '';
            const slotResult = await runTransaction(userRef, (currentData) => {
                if (!currentData) currentData = getDefaultUserData(message.author);
                if ((currentData.coins || 0) < bet) return;
                currentData.coins -= bet;

                const symbols = ['🍒', '🍋', '🔔', '💎', '7️⃣'];
                s1 = symbols[Math.floor(Math.random() * symbols.length)];
                s2 = symbols[Math.floor(Math.random() * symbols.length)];
                s3 = symbols[Math.floor(Math.random() * symbols.length)];

                if (s1 === s2 && s2 === s3) { payout = bet * 5; currentData.coins += payout; }
                else if (s1 === s2 || s2 === s3 || s1 === s3) { payout = bet * 2; currentData.coins += payout; }
                return currentData;
            });

            if (!slotResult.committed) return message.reply("❌ Koin tidak cukup atau transaksi slot gagal.");

            let res = payout > 0 ? (payout === bet * 5 ? `🎉 **JACKPOT! +${payout.toLocaleString()} Koin!**` : `✨ **MENANG! +${payout.toLocaleString()} Koin!**`) : `😢 **KALAH!**`;
            return message.reply({ embeds: [new EmbedBuilder().setTitle("🎰 SLOT KASINO").setDescription(`**[ ${s1} | ${s2} | ${s3} ]**\n\n${res}`).setColor(payout > 0 ? 0x2ECC71 : 0xE74C3C)] });
        }

        if (command === 'repair') {
            if (user.location === "DUNGEON") return message.reply("⛔ Perbaikan hanya di Kota / Safe Zone.");

            const itemId = args[0] ? args[0].toUpperCase() : null;
            if (!itemId) return message.reply("❌ Masukkan ID item! Contoh: `!repair ITM-A8F2`");

            const userRef = ref(database, `users/${userId}`);
            let repairMsg = "";
            const repairResult = await runTransaction(userRef, (currentData) => {
                repairMsg = "";
                if (!currentData) currentData = getDefaultUserData(message.author);
                if (!Array.isArray(currentData.inventory)) currentData.inventory = [];

                let targetItem = currentData.inventory.find(i => i.id === itemId);
                if (!targetItem && currentData.equipment) {
                    for (const slot in currentData.equipment) {
                        if (currentData.equipment[slot] && currentData.equipment[slot].id === itemId) {
                            targetItem = currentData.equipment[slot];
                            break;
                        }
                    }
                }

                if (!targetItem || targetItem.durability === undefined) {
                    repairMsg = "❌ Item tidak ditemukan atau tidak memiliki durability.";
                    return;
                }

                const maxDurability = Number(targetItem.maxDurability || targetItem.durability || 0);
                const currentDurability = Number(targetItem.durability || 0);
                if (maxDurability <= 0) {
                    repairMsg = "❌ Durability maksimal item tidak valid.";
                    return;
                }
                if (currentDurability >= maxDurability) {
                    repairMsg = "❌ Item masih 100% durability, jadi tidak bisa diperbaiki.";
                    return;
                }

                const materialIndex = currentData.inventory.findIndex(i =>
                    i.id !== targetItem.id &&
                    i.type === targetItem.type &&
                    i.name === targetItem.name &&
                    i.durability !== undefined &&
                    Number(i.durability) > 0
                );
                if (materialIndex === -1) {
                    repairMsg = `❌ Butuh **1 item ${targetItem.name}** lain yang masih memiliki durability sebagai bahan repair.`;
                    return;
                }

                const materialItem = currentData.inventory[materialIndex];
                const materialMaxDurability = Number(materialItem.maxDurability || maxDurability);
                const materialDurability = Math.max(0, Number(materialItem.durability || 0));
                if (materialMaxDurability <= 0 || materialDurability <= 0) {
                    repairMsg = `❌ Durability item bahan **${targetItem.name}** tidak valid.`;
                    return;
                }

                const repairAmount = Math.min(materialDurability, maxDurability - currentDurability);
                const itemPrice = Number(targetItem.value || (getItemData(targetItem.name) || {}).value || 0);
                const cost = Math.ceil(itemPrice * 0.30);
                if (itemPrice <= 0) {
                    repairMsg = `❌ Harga **${targetItem.name}** tidak valid, repair dibatalkan.`;
                    return;
                }
                if ((currentData.coins || 0) < cost) {
                    repairMsg = `❌ Koin tidak cukup! Butuh **${cost.toLocaleString()} Koin** dan 1 item **${targetItem.name}** dengan durability **${Math.floor((materialDurability / materialMaxDurability) * 100)}%**.`;
                    return;
                }

                const oldDurability = currentDurability;
                currentData.coins -= cost;
                targetItem.maxDurability = maxDurability;
                targetItem.durability = Math.min(maxDurability, currentDurability + repairAmount);

                currentData.inventory.splice(materialIndex, 1);
                const newDurability = targetItem.durability;
                const oldPercent = Math.floor((oldDurability / maxDurability) * 100);
                const materialPercent = Math.floor((materialDurability / materialMaxDurability) * 100);
                const newPercent = Math.floor((newDurability / maxDurability) * 100);
                repairMsg = `🛠️ Berhasil memperbaiki **${targetItem.name}** dari **${oldPercent}%** menjadi **${newPercent}% durability** dengan bahan yang memiliki **${materialPercent}% durability**.\nBiaya repair: **30% harga item (${cost.toLocaleString()} Koin)** + **1 ${targetItem.name}** sebagai bahan.`;
                return currentData;
            });

            if (!repairResult.committed && !repairMsg.startsWith('❌')) repairMsg = '❌ Perbaikan gagal karena data berubah. Coba lagi.';
            return message.reply(repairMsg || '❌ Perbaikan gagal.');
        }

        if (command === 'summon') {
            if (user.location === "DUNGEON") return message.reply("⛔ Summon pet hanya di Kota / Safe Zone.");

            const petName = args.join(" ").toLowerCase();
            if (!petName) return message.reply("❌ Masukkan nama Pet!");

            const userRef = ref(database, `users/${userId}`);
            let summonMsg = "";
            const summonResult = await runTransaction(userRef, (currentData) => {
                if (!currentData) currentData = getDefaultUserData(message.author);
                if (!Array.isArray(currentData.inventory)) currentData.inventory = [];
                const inv = currentData.inventory;
                const petIdx = inv.findIndex(i => i.type === 'pet' && cleanName(i.name).includes(cleanName(petName)));
                if (petIdx === -1) {
                    summonMsg = "❌ Pet tidak ditemukan di inventory!";
                    return;
                }

                const petItem = inv[petIdx];
                if (currentData.pet) {
                    const petTemplate = getItemData(currentData.pet.name);
                    if (petTemplate) {
                        const dummyUser = { inventory: inv, level: currentData.level || 1 };
                        const added = addConsumableMaterialOrPetToInventory(dummyUser, petTemplate, 1);
                        if (!added) {
                            summonMsg = "❌ **Inventory Penuh!** Tidak dapat menyimpan pet lama ke tas.";
                            return;
                        }
                    }
                }

                currentData.pet = { name: petItem.name, bonus: petItem.bonus };
                petItem.quantity = (petItem.quantity || 1) - 1;
                if (petItem.quantity <= 0) inv.splice(petIdx, 1);

                summonMsg = `🐾 Berhasil memanggil **${currentData.pet.name}**!`;
                return currentData;
            });

            if (!summonResult.committed && !summonMsg.startsWith('❌')) summonMsg = '❌ Summon gagal karena data berubah. Coba lagi.';
            return message.reply(summonMsg || '❌ Summon gagal.');
        }

        if (command === 'dismiss') {
            if (user.location === "DUNGEON") return message.reply("⛔ Tidak bisa dismiss pet di dungeon.");
            if (!user.pet) return message.reply("❌ Tidak ada pet aktif.");

            const userRef = ref(database, `users/${userId}`);
            let dismissMsg = "";
            const dismissResult = await runTransaction(userRef, (currentData) => {
                if (!currentData || !currentData.pet) return;
                const petTemplate = getItemData(currentData.pet.name);
                const dummyUser = { inventory: currentData.inventory || [], level: currentData.level || 1 };

                if (!petTemplate) {
                    const fallbackPet = { name: currentData.pet.name, type: "pet", bonus: currentData.pet.bonus, rarity: "Epic", value: 5000 };
                    const added = addGearOrUniqueToInventory(dummyUser, fallbackPet);
                    if (!added) {
                        dismissMsg = "❌ **Inventory Penuh!** Tasmu penuh, pet tidak bisa dikembalikan.";
                        return;
                    }
                    currentData.pet = null;
                    dismissMsg = `⚠️ Template pet tidak ditemukan, tetapi pet berhasil dipulangkan ke tas.`;
                    return currentData;
                }

                const added = addConsumableMaterialOrPetToInventory(dummyUser, petTemplate, 1);
                if (!added) {
                    dismissMsg = "❌ **Inventory Penuh!** Tasmu sudah mencapai batas maksimal.";
                    return;
                }

                const oldName = currentData.pet.name;
                currentData.pet = null;
                dismissMsg = `🎒 Berhasil menyimpan **${oldName}** kembali ke tas.`;
                return currentData;
            });

            if (!dismissResult.committed && !dismissMsg.startsWith('❌')) dismissMsg = '❌ Gagal mengembalikan pet ke tas. Coba lagi.';
            return message.reply(dismissMsg || '❌ Dismiss gagal.');
        }

        if (command === 'teleport') {
            if (user.activeCombat) {
                return message.reply("⛔ Kamu masih melawan monster/boss! Selesaikan pertarungan terlebih dahulu sebelum menggunakan `!teleport`.");
            }
            if (user.location !== 'CITY') {
                return message.reply("📜 Ancient Return Scroll hanya bisa digunakan dari Kota. Selesaikan pertarungan dan kembali ke Kota terlebih dahulu.");
            }

            const userRef = ref(database, `users/${userId}`);
            let teleportMsg = "";
            const result = await runTransaction(userRef, (data) => {
                if (!data) data = getDefaultUserData(message.author);
                if (!Array.isArray(data.inventory)) data.inventory = [];
                if (data.activeCombat) {
                    teleportMsg = "⛔ Kamu masih melawan monster/boss! Selesaikan pertarungan terlebih dahulu.";
                    return;
                }
                if (data.location !== 'CITY') {
                    teleportMsg = "📜 Ancient Return Scroll hanya bisa digunakan dari Kota.";
                    return;
                }
                const idx = data.inventory.findIndex(i => i.effect === 'return_scroll' && (i.quantity || 1) > 0);
                if (idx < 0) {
                    teleportMsg = "❌ Kamu tidak memiliki Ancient Return Scroll.";
                    return;
                }
                data.floor = Math.max(1, data.lastFloor || 1);
                data.location = data.floor > 1 ? (data.floor % 5 === 1 ? "SAFEZONE" : "DUNGEON") : "CITY";
                data.inventory[idx].quantity = (data.inventory[idx].quantity || 1) - 1;
                if (data.inventory[idx].quantity <= 0) data.inventory.splice(idx, 1);
                teleportMsg = `📜 Berhasil teleport ke progres dungeon terakhir: **Lantai ${data.floor}**.`;
                return data;
            });
            return message.reply(result.committed ? teleportMsg : (teleportMsg || "❌ Gagal menggunakan Ancient Return Scroll."));
        }

        if (command === 'use') {
            const itemName = args.join(" ");
            if (cleanName(itemName).includes('ancient return scroll')) {
                return message.reply("📜 Untuk menggunakan Ancient Return Scroll, ketik `!teleport` saat berada di Kota.");
            }
            if (!itemName) return message.reply("❌ Sebutkan nama item yang ingin digunakan.");
            return message.reply("❌ Item ini belum memiliki efek penggunaan.");
        }

        if (command === 'eat') {
            if (user.location !== "SAFEZONE") return message.reply("⛔ Kamu hanya bisa makan item pemulih HP di **Safe Zone**.");
            const itemName = args.join(" ");
            if (!itemName) return message.reply("❌ Sebutkan nama makanan!");

            const userRef = ref(database, `users/${userId}`);
            let eatMsg = "";
            const eatResult = await runTransaction(userRef, (currentData) => {
                if (!currentData) currentData = getDefaultUserData(message.author);
                if (!Array.isArray(currentData.inventory)) currentData.inventory = [];
                if (currentData.location !== "SAFEZONE") { eatMsg = "⛔ Makan untuk memulihkan HP hanya bisa di Safe Zone."; return; }
                const inv = currentData.inventory;
                const foodIdx = inv.findIndex(i => i.type === 'consumable' && cleanName(i.name).includes(cleanName(itemName)) && i.stats?.hp);
                if (foodIdx === -1) {
                    eatMsg = "❌ Makanan tidak ditemukan!";
                    return;
                }

                const food = inv[foodIdx];
                const stats = calculatePlayerStats(currentData);
                if ((currentData.currentHp || 100) >= stats.hp) {
                    eatMsg = "❌ HP sudah penuh!";
                    return;
                }

                const heal = food.stats.hp;
                const oldHp = currentData.currentHp || 100;
                currentData.currentHp = Math.min(stats.hp, oldHp + heal);

                food.quantity = (food.quantity || 1) - 1;
                if (food.quantity <= 0) inv.splice(foodIdx, 1);

                eatMsg = `🍽️ Memakan **${food.name}** (+${currentData.currentHp - oldHp} HP). HP: **${currentData.currentHp}/${stats.hp}**`;
                return currentData;
            });

            if (!eatResult.committed && !eatMsg.startsWith('❌')) eatMsg = '❌ Makanan gagal digunakan karena data berubah. Coba lagi.';
            return message.reply(eatMsg || '❌ Gagal menggunakan makanan.');
        }

        if (command === 'equip') {
            const itemId = args[0] ? args[0].toUpperCase() : null;
            if (!itemId) return message.reply("❌ Masukkan ID gear!");

            const userRef = ref(database, `users/${userId}`);
            let equipMsg = "";
            const equipResult = await runTransaction(userRef, (currentData) => {
                if (!currentData) currentData = getDefaultUserData(message.author);
                if (!Array.isArray(currentData.inventory)) currentData.inventory = [];
                const inv = currentData.inventory;
                const itemIndex = inv.findIndex(i => i.id && i.id.toUpperCase() === itemId);
                if (itemIndex === -1) {
                    equipMsg = "❌ Gear tidak ditemukan di tas!";
                    return;
                }

                const itemToEquip = inv[itemIndex];
                if (!['weapon', 'armor', 'helm', 'boots'].includes(itemToEquip.type)) {
                    equipMsg = "❌ Item ini bukan gear!";
                    return;
                }

                const slot = itemToEquip.type;
                if (!currentData.equipment) currentData.equipment = { weapon: null, armor: null, helm: null, boots: null };
                const currentEquipped = currentData.equipment[slot];

                inv.splice(itemIndex, 1);
                if (currentEquipped) inv.push(currentEquipped);

                currentData.equipment[slot] = itemToEquip;
                equipMsg = `✅ Berhasil mengenakan **${itemToEquip.name}**!`;
                return currentData;
            });

            if (!equipResult.committed && !equipMsg.startsWith('❌')) equipMsg = '❌ Equip gagal karena data berubah. Coba lagi.';
            return message.reply(equipMsg || '❌ Equip gagal.');
        }

        if (command === 'unequip') {
            const slot = args[0] ? args[0].toLowerCase() : null;
            if (!['weapon', 'armor', 'helm', 'boots'].includes(slot)) {
                return message.reply("❌ Pilih slot: `weapon`, `armor`, `helm`, atau `boots`.");
            }

            const userRef = ref(database, `users/${userId}`);
            let unequipMsg = "";
            const unequipResult = await runTransaction(userRef, (currentData) => {
                if (!currentData || !currentData.equipment || !currentData.equipment[slot]) {
                    unequipMsg = "❌ Slot tersebut kosong.";
                    return;
                }
                const maxS = getMaxInventorySlots(currentData.level || 1);
                if ((currentData.inventory || []).length >= maxS) {
                    unequipMsg = `❌ **Inventory Penuh!** Tasmu penuh (**${maxS} Slot**).`;
                    return;
                }

                const unequipedItem = JSON.parse(JSON.stringify(currentData.equipment[slot]));
                if (!Array.isArray(currentData.inventory)) currentData.inventory = [];
                currentData.inventory.push(unequipedItem);
                currentData.equipment[slot] = null;
                const postStats = calculatePlayerStats(currentData);
                currentData.currentHp = Math.min(currentData.currentHp || 100, postStats.hp);

                unequipMsg = `🎒 Berhasil melepas **${unequipedItem.name}** ke tas. Equipment hanya memengaruhi ATK, DEF, dan Speed.`;
                return currentData;
            });

            if (!unequipResult.committed && !unequipMsg.startsWith('❌')) unequipMsg = '❌ Unequip gagal karena data berubah. Coba lagi.';
            return message.reply(unequipMsg || '❌ Unequip gagal.');
        }

        if (command === 'hunt') {
            const userRef = ref(database, `users/${userId}`);
            let huntReply = "";
            let replyColor = 0x3498DB;

            const huntResult = await runLoggedTransaction("HUNT", userRef, (userData) => {
                if (!userData) {
                    userData = getDefaultUserData(message.author);
                }
                userData.location = normalizeLocation(userData.location, userData.floor);
                if (userData.location === "CITY") {
                    huntReply = "🏰 Kamu masih di Kota (Town). Jalankan `!dungeon` terlebih dahulu untuk masuk ke Dungeon, lalu `!hunt` untuk bertarung.";
                    return;
                }
                if (userData.location === "SAFEZONE") userData.location = "DUNGEON";
                if (userData.location !== "DUNGEON") {
                    huntReply = "⛔ Kamu harus berada di Dungeon untuk menggunakan `!hunt`. Jalankan `!dungeon` dari Kota.";
                    return;
                }

                const floor = Math.max(1, Number(userData.floor) || 1);
                const isBossFloor = floor % 10 === 0;
                const pStats = calculatePlayerStats(userData);
                if (userData.currentHp === undefined || userData.currentHp === null) {
                    userData.currentHp = pStats.hp;
                }
                userData.currentHp = Math.min(userData.currentHp, pStats.hp);

                let combat = userData.activeCombat;
                let durabilityLogs = [];

                if (!combat || combat.floor !== floor) {
                    const cost = isBossFloor ? 100 : 10;
                    if ((userData.coins || 0) < cost) {
                        huntReply = `❌ Butuh **${cost} Koin** untuk memulai pertarungan di Lantai ${floor}.`;
                        return;
                    }

                    userData.coins -= cost;
                    durabilityLogs = processEquipmentDurability(userData);
                    const freshStats = calculatePlayerStats(userData);
                    userData.currentHp = Math.min(userData.currentHp, freshStats.hp);

                    if (isBossFloor) {
                        const template = BOSS_LIST[floor] || {
                            name: "Ancient Warden",
                            hp: 1000,
                            atk: floor * 25
                        };
                        combat = {
                            floor,
                            isBoss: true,
                            name: template.name || `Boss Lantai ${floor}`,
                            maxHp: Math.max(1, Number(template.hp) || 1000),
                            hp: Math.max(1, Number(template.hp) || 1000),
                            atk: Math.max(1, Number(template.atk) || floor * 25)
                        };
                    } else {
                        const monsterHp = 30 + (floor * 8);
                        combat = {
                            floor,
                            isBoss: false,
                            name: `Monster Lantai ${floor}`,
                            maxHp: monsterHp,
                            hp: monsterHp,
                            atk: 5 + (floor * 3)
                        };
                    }
                    userData.activeCombat = combat;
                }

                const currentStats = calculatePlayerStats(userData);
                const playerDamage = Math.max(
                    5,
                    currentStats.atk + Math.floor((currentStats.speed || 0) / 10) -
                    Math.floor(floor * (combat.isBoss ? 1.5 : 0.5))
                );
                combat.hp = Math.max(0, combat.hp - playerDamage);

                let enemyDamage = 0;
                if (combat.hp > 0) {
                    enemyDamage = Math.max(combat.isBoss ? 5 : 3, combat.atk - currentStats.def);
                    userData.currentHp = Math.max(0, userData.currentHp - enemyDamage);
                }

                userData.activeCombat = combat;

                if (userData.currentHp <= 0) {
                    userData.floor = 1;
                    userData.lastFloor = 1;
                    userData.currentHp = currentStats.hp;
                    userData.location = "CITY";
                    userData.safeZoneRestAt = null;
                    userData.activeCombat = null;
                    huntReply =
                        `💀 **KAMU DIKALAHKAN!** ${combat.name} memberikan **${enemyDamage} damage** terakhir.\n` +
                        `Kamu kembali ke **Kota**, dungeon direset ke Lantai 1.\n` +
                        `⚔️ Ronde ini: kamu memberikan **${playerDamage} damage**.`;
                    replyColor = 0xE74C3C;
                    return userData;
                }

                if (combat.hp > 0) {
                    huntReply =
                        `⚔️ **RONDE PERTARUNGAN — LANTAI ${floor}**\n` +
                        `${combat.isBoss ? '👑 **BOSS:**' : '👾 **MUSUH:**'} ${combat.name}\n` +
                        `🗡️ Kamu menyerang dan memberikan **${playerDamage} damage**.\n` +
                        `${combat.name} membalas dengan **${enemyDamage} damage**.\n\n` +
                        `❤️ **HP Kamu:** ${userData.currentHp}/${currentStats.hp}\n` +
                        `🩸 **HP Musuh:** ${combat.hp}/${combat.maxHp}\n` +
                        `➡️ Ketik \`!hunt\` lagi untuk ronde berikutnya.`;
                    if (durabilityLogs.length > 0) {
                        huntReply += `\n\n${durabilityLogs.join('\n')}`;
                    }
                    return userData;
                }

                userData.activeCombat = null;
                const expGained = combat.isBoss ? 75 : 25;
                userData.exp = (userData.exp || 0) + expGained;
                let levelUpText = "";

                while (userData.exp >= userData.maxExp) {
                    userData.level += 1;
                    userData.exp -= userData.maxExp;
                    userData.maxExp = Math.floor(userData.maxExp * 1.5);
                    userData.statPoints += 3;
                    const newMaxSlots = getMaxInventorySlots(userData.level);
                    levelUpText += `\n⭐ **LEVEL UP!** Naik ke **Level ${userData.level}**!\n🎒 *Kapasitas Slot Tas bertambah menjadi **${newMaxSlots} Slot**!*`;
                }

                const dummyUser = { inventory: userData.inventory || [], level: userData.level };
                const drop = getRandomDrop(dummyUser);
                let dropAddedText = "";
                if (drop.type === 'consumable' || drop.type === 'material' || drop.type === 'pet') {
                    const added = addConsumableMaterialOrPetToInventory(dummyUser, drop, 1);
                    if (!added) dropAddedText = `\n⚠️ **Tas Penuh!** Drop **${drop.name}** dibuang karena tas penuh!`;
                } else {
                    const added = addGearOrUniqueToInventory(dummyUser, drop);
                    if (!added) dropAddedText = `\n⚠️ **Tas Penuh!** Drop **${drop.name}** dibuang karena tas penuh!`;
                }
                userData.inventory = dummyUser.inventory;

                const defeatedFloor = floor;
                if (combat.isBoss) {
                    if (defeatedFloor >= 100) {
                        userData.floor = 1;
                        userData.lastFloor = 1;
                        userData.location = "CITY";
                        userData.currentHp = currentStats.hp;
                        userData.safeZoneRestAt = null;
                    } else {
                        userData.floor = defeatedFloor + 1;
                        if (defeatedFloor % 5 === 0) userData.lastFloor = defeatedFloor;
                        userData.location = (defeatedFloor % 5 === 0) ? "SAFEZONE" : "DUNGEON";
                    }
                } else {
                    userData.floor = defeatedFloor + 1;
                    if (defeatedFloor % 5 === 0) userData.lastFloor = defeatedFloor;
                    userData.location = (defeatedFloor % 5 === 0) ? "SAFEZONE" : "DUNGEON";
                }

                const defeatedBoss = combat.isBoss;
                const coinsReward = defeatedBoss ? 0 : (Math.floor(Math.random() * 30) + 10);
                if (coinsReward > 0) userData.coins += coinsReward;
                const completedDungeon = defeatedBoss && defeatedFloor >= 100;
                huntReply = completedDungeon
                    ? `🏆 **DUNGEON SELESAI!** Kamu mengalahkan boss terakhir di Lantai 100 dan kembali ke **Kota**.\n❤️ HP dipulihkan: **${userData.currentHp}/${currentStats.hp}**\n📈 +${expGained} EXP${levelUpText}\n🎁 **Drop:** ${drop.name}${dropAddedText}`
                    : defeatedBoss
                        ? `👑 **BOSS DIKALAHKAN!** ${combat.name} tumbang!\n➡️ Lanjut ke Lantai **${userData.floor}**.\n❤️ Sisa HP: **${userData.currentHp}/${currentStats.hp}**\n📈 +${expGained} EXP${levelUpText}\n🎁 **Drop:** ${drop.name}${dropAddedText}`
                        : `🏆 **MUSUH DIKALAHKAN!** ${combat.name} tumbang!\n🗡️ Damage ronde terakhir: **${playerDamage}**\n➡️ Lanjut ke Lantai **${userData.floor}**.\n❤️ Sisa HP: **${userData.currentHp}/${currentStats.hp}**\n📈 +${expGained} EXP${levelUpText}\n🎁 **Drop:** ${drop.name}${dropAddedText}`;

                if (coinsReward > 0) {
                    huntReply = `💰 +${coinsReward} Koin\n` + huntReply;
                }

                if (durabilityLogs.length > 0) {
                    huntReply += `\n\n${durabilityLogs.join('\n')}`;
                }
                return userData;
            });

            if (!huntResult.committed) {
                console.warn(`[HUNT] transaction not committed for user ${userId}; reason=${huntReply || "no business-validation reason"}`);
                return message.reply(huntReply || "❌ Gagal memproses hunt. Periksa log [TX:HUNT] di console.");
            }

            const updatedUser = await getUser(userId);
            const isTransitionSafeZone =
                updatedUser.floor > 1 &&
                updatedUser.location === "SAFEZONE";

            const updatedStats = calculatePlayerStats(updatedUser);
            const hpPercent = updatedStats.hp > 0 ? (updatedUser.currentHp / updatedStats.hp) * 100 : 0;
            const lowDurability = Object.values(updatedUser.equipment || {}).filter(Boolean)
                .filter(item => item.durability !== undefined && item.maxDurability > 0 && (item.durability / item.maxDurability) * 100 < 30);
            const supplyWarnings = [];
            if (hpPercent < 30) supplyWarnings.push(`❤️ HP rendah (**${Math.round(hpPercent)}%**). Pulihkan HP dengan \`!eat\` di Safe Zone.`);
            if (lowDurability.length > 0) supplyWarnings.push(`🛠️ Durability gear di bawah 30%: ${lowDurability.map(item => `**${item.name}** (${Math.round((item.durability / item.maxDurability) * 100)}%)`).join(', ')}. Perbaiki dengan \`!repair\` atau ganti gear sebelum lanjut.`);
            if (supplyWarnings.length > 0) huntReply += `\n\n⚠️ **PERINGATAN PERSEDIAAN**\n${supplyWarnings.join('\n')}`;

            const embed = new EmbedBuilder()
                .setTitle(
                    updatedUser.location === "CITY"
                        ? "🏁 Pertarungan Berakhir"
                        : updatedUser.activeCombat
                            ? `⚔️ Pertarungan Lantai ${updatedUser.floor}`
                            : updatedUser.floor % 10 === 1 && updatedUser.floor > 1
                                ? "🐉 Boss Floor Dihancurkan!"
                                : `🗡️ Eksplorasi Lantai ${Math.max(1, updatedUser.floor - 1)}`
                )
                .setDescription(huntReply)
                .setColor(replyColor);

            if (isTransitionSafeZone) {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`sz_safe_${userId}`).setLabel('🟢 Istirahat').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`sz_continue_${userId}`).setLabel('⚔️ Lanjut Lantai ' + updatedUser.floor).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`sz_leave_${userId}`).setLabel('🏃‍♂️ Pulang ke Kota').setStyle(ButtonStyle.Danger)
                );
                return message.reply({ embeds: [embed], components: [row] });
            }

            return message.reply({ embeds: [embed] });
        }

        if (command === 'leave' || command === 'exit') {
            const userRef = ref(database, `users/${userId}`);
            const leaveResult = await runTransaction(userRef, (currentData) => {
                if (!currentData) currentData = getDefaultUserData(message.author);
                const wasInCombat = Boolean(currentData.activeCombat);
                const wasInSafeZone = currentData.location === "SAFEZONE";
                const wasInDungeon = currentData.location === "DUNGEON";

                if (wasInCombat && wasInDungeon) {
                    currentData.lastFloor = 1;
                } else if (wasInSafeZone || wasInDungeon) {
                    const completedCheckpoint = Math.floor(((currentData.floor || 1) - 1) / 5) * 5;
                    currentData.lastFloor = Math.max(currentData.lastFloor || 1, completedCheckpoint || 1);
                }

                currentData.location = "CITY";
                currentData.floor = 1;
                currentData.activeCombat = null;
                return currentData;
            });
            if (!leaveResult.committed) {
                return message.reply("❌ Gagal kembali ke Kota. Coba lagi.");
            }
            return message.reply("🏃‍♂️ Kembali ke **Kota (Town)**. Untuk masuk dungeon lagi, jalankan `!dungeon`. Jika masih punya checkpoint, bot akan meminta konfirmasi sebelum memulai ulang.");
        }

        if (command === 'inv' || command === 'inventory') {
            const inv = user.inventory;
            let list = "*Inventory kosong.*";
            if (inv.length > 0) {
                list = inv.map((item, i) => {
                    if (item.type === 'consumable' || item.type === 'material' || item.type === 'pet') {
                        return `**${i + 1}.** **${item.name}** — x${item.quantity || 1} (${item.rarity})`;
                    }
                    const maxDur = item.maxDurability || 50;
                    const curDur = item.durability !== undefined ? item.durability : maxDur;
                    const percentage = Math.round((curDur / maxDur) * 100);
                    return `**${i + 1}.** [ID: \`${item.id}\`] **${item.name}** (Dur: ${curDur}/${maxDur} - ${percentage}%)`;
                }).join('\n');
            }

            const embed = new EmbedBuilder()
                .setTitle(`🎒 Inventory ${message.author.username}`)
                .setDescription(`🌟 **Level:** ${user.level} | 📦 **Slot Tas:** **${inv.length}/${maxSlots}**\n💰 **Koin:** ${user.coins.toLocaleString('id-ID')}`)
                .addFields({ name: "📦 Daftar Item", value: list.length > 1024 ? list.slice(0, 1020) + "..." : list })
                .setColor(0x2ECC71);

            return message.reply({ embeds: [embed] });
        }

    } catch (error) {
        console.error("Error executing command:", error);
        return message.reply("❌ Terjadi kesalahan sistem saat memproses perintah kamu.").catch(() => {});
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() || (!interaction.customId.startsWith('sz_') && !interaction.customId.startsWith('dn_'))) return;

    try {
        const parts = interaction.customId.split('_');
        const action = parts[1];
        const ownerId = parts[2];
        const isDungeonAction = interaction.customId.startsWith('dn_');

        if (interaction.user.id !== ownerId) {
            return interaction.reply({ content: "❌ Tombol ini bukan milik karaktermu!", ephemeral: true });
        }

        if (isDungeonAction) {
            if (!['reset', 'keep'].includes(action)) {
                return interaction.reply({ content: "❌ Aksi dungeon tidak dikenal.", ephemeral: true });
            }
            if (action === 'keep') {
                return interaction.update({ content: "↩️ Dibatalkan. Kamu tetap di Kota dan checkpoint lama tidak berubah. Jalankan `!dungeon` lagi jika ingin masuk.", components: [] });
            }
            const resetResult = await runTransaction(ref(database, `users/${ownerId}`), (data) => {
                if (!data) data = getDefaultUserData(interaction.user);
                if (data.location !== "CITY" || data.activeCombat || Number(data.lastFloor || 1) <= 1) return data;
                data.floor = 1;
                data.lastFloor = 1;
                data.location = "DUNGEON";
                data.activeCombat = null;
                return data;
            });
            if (!resetResult.committed) {
                return interaction.update({ content: "❌ Gagal masuk dungeon. Pastikan kamu masih di Kota dan coba jalankan `!dungeon` lagi.", components: [] });
            }
            return interaction.update({ content: "🚪 **Kamu masuk ke Dungeon dari Lantai 1!** Checkpoint lama telah ditimpa menjadi lantai 1. Jalankan `!hunt` untuk bertarung.", components: [] });
        }

        if (!['safe', 'continue', 'leave'].includes(action)) {
            return interaction.reply({ content: "❌ Aksi tombol tidak dikenal.", ephemeral: true });
        }

        const userRef = ref(database, `users/${ownerId}`);
        const locationResult = await runTransaction(userRef, (userData) => {
            if (!userData) userData = getDefaultUserData(interaction.user);
            if (action === 'safe') {
                userData.location = "SAFEZONE";
            } else if (action === 'continue') {
                userData.location = "DUNGEON";
            } else if (action === 'leave') {
                const wasInCombat = Boolean(userData.activeCombat);
                const wasInSafeZone = userData.location === "SAFEZONE";
                const wasInDungeon = userData.location === "DUNGEON";

                if (wasInCombat && wasInDungeon) {
                    userData.lastFloor = 1;
                } else if (wasInSafeZone || wasInDungeon) {
                    const completedCheckpoint = Math.floor(((userData.floor || 1) - 1) / 5) * 5;
                    userData.lastFloor = Math.max(userData.lastFloor || 1, completedCheckpoint || 1);
                }
                userData.location = "CITY";
                userData.floor = 1;
                userData.activeCombat = null;
            }
            return userData;
        });

        if (!locationResult.committed) {
            return interaction.reply({ content: "❌ Gagal memperbarui lokasi.", ephemeral: true });
        }

        const updatedUser = await getUser(ownerId);
        const msgMap = {
            safe: "🟢 Beristirahat di **Safe Zone**. Ketik `!hunt` untuk lanjut.",
            continue: `⚔️ Melanjutkan ke **Lantai ${updatedUser.floor}**!`,
            leave: "🏃‍♂️ Pulang ke **Kota (Town)**. Jalankan `!dungeon` untuk masuk lagi; jika masih ada checkpoint, bot akan meminta konfirmasi sebelum memulai ulang."
        };
        return interaction.update({ content: msgMap[action], embeds: [], components: [] });
    } catch (error) {
        console.error("Error handling safe-zone interaction:", error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "❌ Terjadi kesalahan saat memproses tombol.", ephemeral: true }).catch(() => {});
        }
    }
});

client.login(process.env.DISCORD_TOKEN);

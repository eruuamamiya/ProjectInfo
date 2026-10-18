require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    PermissionFlagsBits 
} = require('discord.js');

const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, set } = require('firebase/database');

// Inisialisasi Firebase
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

// Helper: Ambil / Buat Data User dari Firebase
async function getUser(userId, userObject = null) {
    const userRef = ref(database, `users/${userId}`);
    const snapshot = await get(userRef);

    if (!snapshot.exists()) {
        const defaultData = {
            username: userObject ? userObject.username : "Unknown",
            coins: 1000, 
            inventory: [],
            equipment: { weapon: null, armor: null, helm: null, boots: null },
            floor: 1,
            lastHunt: 0
        };
        await set(userRef, defaultData);
        return defaultData;
    }

    const userData = snapshot.val();
    if (userObject && userData.username !== userObject.username) {
        userData.username = userObject.username;
        await set(userRef, userData);
    }

    if (!userData.inventory) userData.inventory = [];
    return userData;
}

// Helper: Simpan Data User ke Firebase
async function saveUser(userId, userData) {
    const userRef = ref(database, `users/${userId}`);
    await set(userRef, userData);
}

// Helper: Cek apakah ID sudah ada di inventory player
function isIdExists(inventory, id) {
    return inventory.some(item => item.id === id);
}

// Helper: Generate ID Unik 100% Anti-Duplikat
function generateUniqueItemId(inventory) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let newId;
    do {
        let result = '';
        for (let i = 0; i < 4; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        newId = `ITM-${result}`;
    } while (isIdExists(inventory, newId));

    return newId;
}

// ==========================================
// POOL ITEM MINECRAFT & MARKETPLACE LIST
// ==========================================
const ITEMS = {
    ALL_ITEMS: [
        // TIER WOOD (Common & Consumable Makanan / Heal)
        { name: "Wooden Sword 🪵", type: "weapon", stats: { atk: 5 }, rarity: "Common", value: 100 },
        { name: "Wooden Helmet 🪖", type: "helm", stats: { def: 3 }, rarity: "Common", value: 80 },
        { name: "Wooden Boots 🥾", type: "boots", stats: { def: 2 }, rarity: "Common", value: 50 },
        { name: "Wooden Chestplate 🧥", type: "armor", stats: { def: 8 }, rarity: "Common", value: 150 },
        
        // MAKANAN / HEAL ITEM
        { name: "Grilled Fish 🐟", type: "consumable", stats: { hp: 25 }, rarity: "Common", value: 120, buyPrice: 200 },
        { name: "Grilled Chicken 🍗", type: "consumable", stats: { hp: 40 }, rarity: "Common", value: 220, buyPrice: 350 },
        { name: "Golden Apple 🍎", type: "consumable", stats: { hp: 50 }, rarity: "Common", value: 300, buyPrice: 500 },
        { name: "Steak 🥩", type: "consumable", stats: { hp: 75 }, rarity: "Rare", value: 450, buyPrice: 750 },

        // TIER IRON (Rare)
        { name: "Iron Sword 🗡️", type: "weapon", stats: { atk: 15 }, rarity: "Rare", value: 1000 },
        { name: "Iron Helmet ⛑️", type: "helm", stats: { def: 10 }, rarity: "Rare", value: 800 },
        { name: "Iron Boots 🥾", type: "boots", stats: { def: 8 }, rarity: "Rare", value: 700 },
        { name: "Iron Chestplate 🛡️", type: "armor", stats: { def: 20 }, rarity: "Rare", value: 1500 },

        // TIER GOLD (Epic)
        { name: "Golden Sword ⚔️", type: "weapon", stats: { atk: 25 }, rarity: "Epic", value: 7500 },
        { name: "Golden Helmet 👑", type: "helm", stats: { def: 18, hp: 20 }, rarity: "Epic", value: 6000 },
        { name: "Golden Boots 👢", type: "boots", stats: { def: 15, hp: 15 }, rarity: "Epic", value: 5000 },
        { name: "Golden Chestplate 🛡️", type: "armor", stats: { def: 35, hp: 40 }, rarity: "Epic", value: 10000 },

        // TIER DIAMOND (Legendary)
        { name: "Diamond Sword 💎", type: "weapon", stats: { atk: 50, hp: 50 }, rarity: "Legendary", value: 25000 },
        { name: "Diamond Helmet 💠", type: "helm", stats: { def: 30, hp: 50 }, rarity: "Legendary", value: 20000 },
        { name: "Diamond Boots 🛼", type: "boots", stats: { def: 25, hp: 40 }, rarity: "Legendary", value: 15000 },
        { name: "Diamond Chestplate 🔷", type: "armor", stats: { def: 60, hp: 100 }, rarity: "Legendary", value: 40000 }
    ]
};

// ==========================================
// LIST BOSS DUNGEON BERDASARKAN LANTAI
// ==========================================
const BOSS_LIST = {
    10: { name: "Zombie Giant 🧟", hp: 150, atk: 25 },
    20: { name: "Cave Spider Queen 🕷️", hp: 300, atk: 45 },
    30: { name: "Blaze Commander 🔥", hp: 550, atk: 75 },
    40: { name: "Wither Skeleton King 💀", hp: 900, atk: 110 },
    50: { name: "Ender Dragon Avatar 🐉", hp: 1500, atk: 160 }
};

function getItemData(itemName) {
    return ITEMS.ALL_ITEMS.find(i => i.name.toLowerCase() === itemName.toLowerCase());
}

function createItemInstance(itemTemplate, inventory) {
    return {
        id: generateUniqueItemId(inventory),
        name: itemTemplate.name,
        type: itemTemplate.type,
        stats: itemTemplate.stats || {},
        rarity: itemTemplate.rarity,
        value: itemTemplate.value,
        buyPrice: itemTemplate.buyPrice || null
    };
}

function getRandomItemEqualRate(inventory) {
    const template = ITEMS.ALL_ITEMS[Math.floor(Math.random() * ITEMS.ALL_ITEMS.length)];
    return createItemInstance(template, inventory);
}

function rollGacha(inventory) {
    const rand = Math.random();
    let pool = [];
    if (rand < 0.05) pool = ITEMS.ALL_ITEMS.filter(i => i.rarity === 'Legendary');
    else if (rand < 0.25) pool = ITEMS.ALL_ITEMS.filter(i => i.rarity === 'Epic');
    else if (rand < 0.60) pool = ITEMS.ALL_ITEMS.filter(i => i.rarity === 'Rare');
    else pool = ITEMS.ALL_ITEMS.filter(i => i.rarity === 'Common');

    const template = pool[Math.floor(Math.random() * pool.length)];
    return createItemInstance(template, inventory);
}

function getRarityColor(rarity) {
    switch (rarity) {
        case 'Common': return 0x95A5A6;
        case 'Rare': return 0x3498DB;
        case 'Epic': return 0xF1C40F;
        case 'Legendary': return 0x00FFFF;
        default: return 0xFFFFFF;
    }
}

function calculatePlayerStats(user) {
    let atk = 10;
    let def = 5;
    let hp = 100;

    if (user.equipment) {
        for (const slot in user.equipment) {
            const equippedItem = user.equipment[slot];
            if (equippedItem && equippedItem.stats) {
                if (equippedItem.stats.atk) atk += equippedItem.stats.atk;
                if (equippedItem.stats.def) def += equippedItem.stats.def;
                if (equippedItem.stats.hp) hp += equippedItem.stats.hp;
            }
        }
    }
    return { atk, def, hp };
}

client.once('ready', () => {
    console.log(`🤖 Adventure Time Bot Online (Firebase Connected)! Login: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const userId = message.author.id;
    const user = await getUser(userId, message.author);

    // ==========================================
    // 0. MENU / HELP COMMAND
    // ==========================================
    if (command === 'menu' || command === 'help') {
        const menuEmbed = new EmbedBuilder()
            .setTitle("🗺️ Adventure Time Bot - Daftar Command")
            .setDescription("Berikut adalah daftar command yang bisa kamu gunakan di dalam game:")
            .addFields(
                { 
                    name: "⛏️ Informasi & Karakter", 
                    value: "`!profile` / `!stats` - Melihat status karakter & gear\n`!inv` / `!inventory` - Mengecek isi tas & ID item\n`!topup` - Informasi cara top-up koin (QRIS)", 
                    inline: false 
                },
                { 
                    name: "🛒 Marketplace & Gear", 
                    value: "`!market` - Melihat daftar makanan\n`!buy [Nama Makanan]` - Membeli makanan\n`!equip [ID_Item]` - Memasang senjata/armor\n`!sell [ID_Item]` - Menjual item ke sistem", 
                    inline: false 
                },
                { 
                    name: "⚔️ Dungeon & Kasino", 
                    value: "`!hunt` - Menjelajah / melawan monster/boss\n`!leave` / `!exit` - Keluar dungeon ke lantai 1\n`!gacha` - Buka gacha chest (500 Koin)\n`!slot [Jumlah]` - Main mesin slot koin", 
                    inline: false 
                },
                { 
                    name: "📜 Sistem Rekber RMT", 
                    value: "`!rekber @buyer @seller [ID_Item] [Harga_Rp]` - Buka tiket escrow", 
                    inline: false 
                }
            )
            .setColor(0x3498DB);

        if (userId === DEV_ID) {
            menuEmbed.addFields({
                name: "👑 Khusus Admin / Developer",
                value: "`!addcoins @user [jumlah]` - Menambah koin player\n`!additem @user [Nama Item]` - Memberi item ke player",
                inline: false
            });
        }

        return message.reply({ embeds: [menuEmbed] });
    }

    // ==========================================
    // 1. PROFILE & STATS
    // ==========================================
    if (command === 'profile' || command === 'stats') {
        const stats = calculatePlayerStats(user);
        const eq = user.equipment || {};

        const embed = new EmbedBuilder()
            .setTitle(`⛏️ Minecraft Stats: ${message.author.username}`)
            .addFields(
                { name: "🏰 Dungeon Floor", value: `Lantai ${user.floor}`, inline: true },
                { name: "💰 Saldo Koin", value: `${user.coins.toLocaleString('id-ID')} 🪙 (Rp ${(user.coins * 10).toLocaleString('id-ID')})`, inline: true },
                { name: "⚔️ Total Stats Kamu", value: `• ATK: **${stats.atk}**\n• DEF: **${stats.def}**\n• HP Max: **${stats.hp}**`, inline: false },
                { name: "🎽 Gear Terpasang", value: `• Weapon: **${eq.weapon ? eq.weapon.name : 'Kosong'}**\n• Armor: **${eq.armor ? eq.armor.name : 'Kosong'}**\n• Helm: **${eq.helm ? eq.helm.name : 'Kosong'}**\n• Boots: **${eq.boots ? eq.boots.name : 'Kosong'}**`, inline: false }
            )
            .setColor(0x3498DB);

        return message.reply({ embeds: [embed] });
    }

    // ==========================================
    // 2. MARKETPLACE & BUY
    // ==========================================
    if (command === 'market') {
        const marketEmbed = new EmbedBuilder()
            .setTitle("🛒 MINECRAFT FOOD MARKETPLACE")
            .setDescription("Beli persediaan makanan untuk memperkuat HP dan bertahan hidup di dungeon!\n\n**Menu Makanan:**\n" +
                "🐟 **Grilled Fish 🐟** ➔ HP +25 | Harga: **200 Koin**\n" +
                "🍗 **Grilled Chicken 🍗** ➔ HP +40 | Harga: **350 Koin**\n" +
                "🍎 **Golden Apple 🍎** ➔ HP +50 | Harga: **500 Koin**\n" +
                "🥩 **Steak 🥩** ➔ HP +75 | Harga: **750 Koin**\n\n" +
                "💡 *Cara beli:* Ketik `!buy [Nama Makanan]` (Contoh: `!buy Steak 🥩`)")
            .setColor(0x2ECC71);

        return message.reply({ embeds: [marketEmbed] });
    }

    if (command === 'buy') {
        const itemName = args.join(" ");
        if (!itemName) return message.reply("❌ Sebutkan nama makanan yang ingin dibeli! Contoh: `!buy Steak 🥩`");

        const itemTemplate = getItemData(itemName);
        if (!itemTemplate || !itemTemplate.buyPrice) {
            return message.reply("❌ Item tersebut tidak tersedia di Marketplace makanan!");
        }

        if (user.coins < itemTemplate.buyPrice) {
            return message.reply(`❌ Koin kamu tidak cukup! Harga **${itemTemplate.name}** adalah **${itemTemplate.buyPrice} Koin**. (Koinmu:${user.coins})`);
        }

        user.coins -= itemTemplate.buyPrice;
        if (!user.inventory) user.inventory = [];
        
        const newItem = createItemInstance(itemTemplate, user.inventory);
        user.inventory.push(newItem);
        await saveUser(userId, user);

        return message.reply(`✅ Berhasil membeli **${newItem.name}** (ID: \`${newItem.id}\`) seharga **${itemTemplate.buyPrice} Koin**! Makanan disimpan di inventory.`);
    }

    // ==========================================
    // 3. EQUIP ITEM
    // ==========================================
    if (command === 'equip') {
        const itemId = args[0] ? args[0].toUpperCase() : null;
        if (!itemId) return message.reply("❌ Masukkan ID item yang ingin dipasang! Contoh: `!equip ITM-A8F2` (Cek ID di `!inv`)");

        if (!user.inventory) user.inventory = [];
        const itemIndex = user.inventory.findIndex(i => i.id === itemId);
        if (itemIndex === -1) return message.reply(`❌ Item dengan ID \`${itemId}\` tidak ditemukan di inventory kamu!`);

        const itemToEquip = user.inventory[itemIndex];
        if (!itemToEquip.type || itemToEquip.type === 'consumable') {
            return message.reply("❌ Item ini adalah makanan/consumable dan tidak bisa dipakai sebagai equipment gear!");
        }

        const slot = itemToEquip.type;
        if (!user.equipment) user.equipment = { weapon: null, armor: null, helm: null, boots: null };
        const currentEquipped = user.equipment[slot];

        user.inventory.splice(itemIndex, 1);

        if (currentEquipped) {
            user.inventory.push(currentEquipped);
        }

        user.equipment[slot] = itemToEquip;
        await saveUser(userId, user);

        return message.reply(`✅ Berhasil mengenakan **${itemToEquip.name}** (ID: \`${itemToEquip.id}\`) pada slot **${slot.toUpperCase()}**!`);
    }

    // ==========================================
    // 4. ADMIN / DEV COMMANDS
    // ==========================================
    if (command === 'addcoins') {
        if (userId !== DEV_ID) return message.reply("⛔ **Akses Ditolak!** Khusus Admin.");
        
        const targetUser = message.mentions.users.first();
        const amount = parseInt(args[1]);

        if (!targetUser || isNaN(amount)) {
            return message.reply("❌ Format: `!addcoins @user [jumlah]`");
        }

        const targetId = targetUser.id;
        const targetData = await getUser(targetId, targetUser);
        targetData.coins += amount;
        await saveUser(targetId, targetData);

        return message.reply(`✅ Berhasil menambahkan **+${amount.toLocaleString('id-ID')} Koin** ke <@${targetId}>.`);
    }

    if (command === 'additem') {
        if (userId !== DEV_ID) return message.reply("⛔ **Akses Ditolak!** Khusus Admin.");

        const targetUser = message.mentions.users.first();
        const itemName = args.slice(1).join(" ");

        if (!targetUser || !itemName) {
            return message.reply("❌ Format: `!additem @user [Nama Item]`");
        }

        const template = getItemData(itemName);
        if (!template) return message.reply(`❌ Item **"${itemName}"** tidak ditemukan!`);

        const targetId = targetUser.id;
        const targetData = await getUser(targetId, targetUser);
        if (!targetData.inventory) targetData.inventory = [];

        const newItem = createItemInstance(template, targetData.inventory);
        targetData.inventory.push(newItem);
        await saveUser(targetId, targetData);

        return message.reply(`✅ Berhasil memberikan **${newItem.name}** (ID: \`${newItem.id}\`) ke inventory <@${targetId}>!`);
    }

    // ==========================================
    // 5. TOP-UP INFO (HANYA QRIS)
    // ==========================================
    if (command === 'topup') {
        const topupEmbed = new EmbedBuilder()
            .setTitle("💳 MENU TOP-UP KOIN (Rp 10.000 = 1.000 Koin)")
            .setDescription("Isi Koin untuk modal **!hunt**, **!gacha**, **!market**, atau **!slot**!\n\nSilahkan scan QR di bawah ini menggunakan aplikasi e-wallet / m-banking apa saja:")
            .addFields(
                { name: "💵 Price List", value: "• Rp 10.000 ➔ **1.000 Koin**\n• Rp 50.000 ➔ **5.000 Koin**\n• Rp 100.000 ➔ **10.000 Koin**", inline: false },
                { name: "📌 Konfirmasi", value: "Kirim bukti transfer/screenshot QRIS ke <@" + DEV_ID + ">.", inline: false }
            )
            .setImage("https://i.ibb.co.com/v6G3XvxZ/qr-ID1022196069820-19-10-26-1792350449-1792350449365.jpg")
            .setColor(0xF1C40F);

        return message.reply({ embeds: [topupEmbed] });
    }

    // ==========================================
    // 6. SYSTEM HUNT & DUNGEON
    // ==========================================
    if (command === 'hunt') {
        const COOLDOWN_TIME = 60 * 1000;
        const now = Date.now();

        if (now - (user.lastHunt || 0) < COOLDOWN_TIME) {
            const timeLeft = Math.ceil((COOLDOWN_TIME - (now - user.lastHunt)) / 1000);
            return message.reply(`⏳ Kamu masih lelah! Tunggu **${timeLeft} detik** lagi.`);
        }

        const isBossFloor = (user.floor % 10 === 0);
        const tierLevel = Math.floor(user.floor / 10);
        const huntCost = isBossFloor ? (tierLevel * 100) : 10; 

        if (user.coins < huntCost) {
            return message.reply(`❌ Koin tidak cukup! Lantai ${user.floor} butuh **${huntCost} Koin**.`);
        }

        user.coins -= huntCost;
        user.lastHunt = now;
        const pStats = calculatePlayerStats(user);

        if (isBossFloor) {
            const bossData = BOSS_LIST[user.floor] || { name: "Ancient Warden 🪨", hp: user.floor * 150, atk: user.floor * 25 };
            
            if (pStats.atk * 2 < bossData.atk && pStats.hp < bossData.atk) {
                user.floor = 1; 
                await saveUser(userId, user);
                return message.reply(`💀 **KAMU TUMBANG DIHADAPAN BOSS!**\nStats kamu terlalu lemah untuk mengalahkan **${bossData.name}**.\n\n⚠️ *Progres lantai di-reset kembali ke **Lantai 1**.*`);
            }

            if (!user.inventory) user.inventory = [];
            const bossLoot = getRandomItemEqualRate(user.inventory);
            user.inventory.push(bossLoot);
            user.floor += 1;
            await saveUser(userId, user);

            const embed = new EmbedBuilder()
                .setTitle(`⚔️ BOSS FLOOR ${user.floor - 1} DIKALAHKAN! 🐉`)
                .setDescription(`Musuh: **${bossData.name}**\n\n🎁 **Hadiah Drop:**\n📦 **${bossLoot.name}** (ID: \`${bossLoot.id}\`)\n⭐ **[ ${bossLoot.rarity} ]**`)
                .setColor(getRarityColor(bossLoot.rarity));

            return message.reply({ embeds: [embed] });
        } else {
            const monsterHp = 30 + (user.floor * 10);
            const monsterAtk = 5 + (user.floor * 3);

            if (pStats.hp <= monsterAtk && pStats.atk < monsterHp / 2) {
                user.floor = 1; 
                await saveUser(userId, user);
                return message.reply(`💀 **KAMU TERBUNUH OLEH MONSTER!**\nProgres lantai di-reset kembali ke **Lantai 1**.`);
            }

            const coinsEarned = Math.floor(Math.random() * 30) + 10;
            user.coins += coinsEarned;
            const currentFloor = user.floor;
            user.floor += 1;
            await saveUser(userId, user);

            const embed = new EmbedBuilder()
                .setTitle(`🗡️ Eksplorasi Dungeon (Lantai ${currentFloor})`)
                .setDescription(`💰 Koin Didapat: **+${coinsEarned} Koin**\n➡️ Naik ke **Lantai ${user.floor}**`)
                .setColor(0x3498DB);

            return message.reply({ embeds: [embed] });
        }
    }

    if (command === 'leave' || command === 'exit') {
        if (user.floor === 1) return message.reply("❌ Kamu sedang berada di luar dungeon (Lantai 1).");
        
        user.floor = 1;
        await saveUser(userId, user);
        return message.reply("🏃‍♂️ Kamu memutuskan mundur dan keluar dari dungeon. Progres lantai dikembalikan ke **Lantai 1**.");
    }

    // ==========================================
    // 7. GACHA & SLOT
    // ==========================================
    if (command === 'gacha') {
        const GACHA_COST = 500;
        if (user.coins < GACHA_COST) return message.reply(`❌ Butuh **${GACHA_COST} Koin** untuk Gacha.`);

        user.coins -= GACHA_COST;
        if (!user.inventory) user.inventory = [];
        const gachaResult = rollGacha(user.inventory);
        user.inventory.push(gachaResult);
        await saveUser(userId, user);

        const embed = new EmbedBuilder()
            .setTitle("🎰 Gacha Chest Terbuka!")
            .setDescription(`🎉 Kamu mendapatkan:\n**${gachaResult.name}** (ID: \`${gachaResult.id}\`)\nRarity: **[ ${gachaResult.rarity} ]**`)
            .setColor(getRarityColor(gachaResult.rarity));

        return message.reply({ embeds: [embed] });
    }

    if (command === 'slot') {
        const betAmount = parseInt(args[0]);
        if (isNaN(betAmount) || betAmount <= 0 || user.coins < betAmount) return message.reply("❌ Taruhan tidak valid!");

        user.coins -= betAmount;
        const symbols = ['🍒', '🍋', '🔔', '💎', '7️⃣'];
        const s1 = symbols[Math.floor(Math.random() * symbols.length)];
        const s2 = symbols[Math.floor(Math.random() * symbols.length)];
        const s3 = symbols[Math.floor(Math.random() * symbols.length)];

        let payout = 0;
        let res = "";
        if (s1 === s2 && s2 === s3) { payout = betAmount * 5; user.coins += payout; res = `🎉 **JACKPOT! +${payout} Koin!**`; }
        else if (s1 === s2 || s2 === s3 || s1 === s3) { payout = betAmount * 2; user.coins += payout; res = `✨ **MENANG! +${payout} Koin!**`; }
        else { res = `😢 **KALAH! Kehilangan ${betAmount} Koin.**`; }

        await saveUser(userId, user);

        const embed = new EmbedBuilder().setTitle("🎰 SLOT KASINO").setDescription(`**[ ${s1} \vert{}${s2} | ${s3} ]**\n\n${res}`).setColor(payout > 0 ? 0x2ECC71 : 0xE74C3C);
        return message.reply({ embeds: [embed] });
    }

    // ==========================================
    // 8. INVENTORY & SELL
    // ==========================================
    if (command === 'inv' || command === 'inventory') {
        const inv = user.inventory || [];
        let invList = "*Inventory kosong.*";
        
        if (inv.length > 0) {
            invList = inv.map((item, i) => `**${i + 1}.** [ID: \`${item.id}\`] **${item.name}** (${item.rarity})`).join('\n');
        }

        const embed = new EmbedBuilder()
            .setTitle(`🎒 Inventory ${message.author.username}`)
            .setDescription(`💡 *Gunakan ID untuk menjual (\`!sell [ID]\`) atau pakai gear (\`!equip [ID]\`)*`)
            .addFields(
                { name: "💰 Saldo Koin", value: `${user.coins.toLocaleString('id-ID')} 🪙`, inline: true },
                { name: "📜 Daftar Item", value: invList }
            )
            .setColor(0x2ECC71);

        return message.reply({ embeds: [embed] });
    }

    if (command === 'sell') {
        const itemId = args[0] ? args[0].toUpperCase() : null;
        if (!itemId) return message.reply("❌ Masukkan ID item yang ingin dijual! Contoh: `!sell ITM-A8F2` (Cek ID di `!inv`)");

        const inv = user.inventory || [];
        const idx = inv.findIndex(i => i.id === itemId);
        if (idx === -1) return message.reply(`❌ Item dengan ID \`${itemId}\` tidak ditemukan di inventory kamu!`);

        const itemToSell = inv[idx];
        const val = itemToSell.value || 100;

        inv.splice(idx, 1);
        user.coins += val;
        await saveUser(userId, user);

        return message.reply(`✅ Berhasil menjual **${itemToSell.name}** (ID: \`${itemToSell.id}\`) seharga **+${val.toLocaleString('id-ID')} Koin**!`);
    }

    // ==========================================
    // 9. REKBER RMT HOLD
    // ==========================================
    if (command === 'rekber') {
        const buyer = message.mentions.users.first();
        const seller = message.mentions.users.first(2)[1] || message.mentions.users.first();
        const itemId = args[2] ? args[2].toUpperCase() : null;
        const price = parseInt(args[3]);

        if (!buyer || !seller || !itemId || isNaN(price)) {
            return message.reply("❌ Format salah! Gunakan: `!rekber @buyer @seller [ID_Item] [Harga_Rp]`\nContoh: `!rekber @buyer @seller ITM-A8F2 50000`");
        }

        const sellerId = seller.id;
        const sData = await getUser(sellerId, seller);
        const inv = sData.inventory || [];
        const idx = inv.findIndex(i => i.id === itemId);

        if (idx === -1) return message.reply(`❌ Seller tidak memiliki item dengan ID \`${itemId}\` di inventory mereka!`);

        const itemToTrade = inv[idx];

        sData.inventory.splice(idx, 1);
        await saveUser(sellerId, sData);

        const txId = `TX-${Math.floor(1000 + Math.random() * 9000)}`;

        const channel = await message.guild.channels.create({
            name: `ticket-${txId.toLowerCase()}`,
            permissionOverwrites: [
                { id: message.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: buyer.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: seller.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: DEV_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
            ]
        });

        await set(ref(database, `tickets/${channel.id}`), {
            txId, sellerId, buyerId: buyer.id, itemObj: itemToTrade, price, status: "WAITING_PAYMENT"
        });

        const embedTicket = new EmbedBuilder()
            .setTitle(`📜 Rekber Official (${txId})`)
            .addFields(
                { name: "📦 Item yang Ditransaksikan", value: `${itemToTrade.name} (${itemToTrade.rarity})\nID: \`${itemToTrade.id}\`` },
                { name: "💵 Harga", value: `Rp ${price.toLocaleString('id-ID')}` }
            )
            .setColor(0xE67E22);

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('confirm_payment').setLabel('✅ Konfirmasi Pembayaran').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('cancel_tx').setLabel('❌ Batalkan').setStyle(ButtonStyle.Danger)
        );

        await channel.send({ content: `<@${buyer.id}> <@${seller.id}> <@${DEV_ID}>`, embeds: [embedTicket], components: [buttons] });
        return message.reply(`✅ Channel Rekber dibuat: ${channel}`);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.user.id !== DEV_ID) return;

    const ticketRef = ref(database, `tickets/${interaction.channelId}`);
    const snapshot = await get(ticketRef);
    if (!snapshot.exists()) return interaction.reply({ content: "❌ Data transaksi tidak ditemukan!", ephemeral: true });

    const txData = snapshot.val();

    if (interaction.customId === 'confirm_payment') {
        const buyerData = await getUser(txData.buyerId, interaction.user);
        if (!buyerData.inventory) buyerData.inventory = [];
        
        buyerData.inventory.push(txData.itemObj);
        await saveUser(txData.buyerId, buyerData);

        await set(ticketRef, null);
        await interaction.update({ content: `🎉 Transaksi selesai! Item **${txData.itemObj.name}** (\`${txData.itemObj.id}\`) dikirim ke buyer.`, embeds: [], components: [] });
        setTimeout(() => interaction.channel.delete().catch(() => {}), 10000);
    } else if (interaction.customId === 'cancel_tx') {
        const sellerData = await getUser(txData.sellerId, interaction.user);
        if (!sellerData.inventory) sellerData.inventory = [];
        
        sellerData.inventory.push(txData.itemObj);
        await saveUser(txData.sellerId, sellerData);

        await set(ticketRef, null);
        await interaction.update({ content: "❌ Transaksi dibatalkan. Item dikembalikan ke seller.", embeds: [], components: [] });
        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }
});

client.login(process.env.DISCORD_TOKEN);
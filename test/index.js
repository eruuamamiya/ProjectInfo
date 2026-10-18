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
async function getUser(userId) {
    const userRef = ref(database, `users/${userId}`);
    const snapshot = await get(userRef);

    if (!snapshot.exists()) {
        const defaultData = {
            coins: 1000, // Modal awal 1.000 Koin (Setara Rp 100.000)
            inventory: [],
            equipment: { weapon: null, armor: null, helm: null, boots: null },
            floor: 1,
            lastHunt: 0
        };
        await set(userRef, defaultData);
        return defaultData;
    }
    return snapshot.val();
}

// Helper: Simpan Data User ke Firebase
async function saveUser(userId, userData) {
    const userRef = ref(database, `users/${userId}`);
    await set(userRef, userData);
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
        
        // MAKANAN / HEAL ITEM (Bisa dibeli di Market)
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

function getRandomItemEqualRate() {
    const list = ITEMS.ALL_ITEMS;
    return list[Math.floor(Math.random() * list.length)];
}

function rollGacha() {
    const rand = Math.random();
    if (rand < 0.05) {
        const items = ITEMS.ALL_ITEMS.filter(i => i.rarity === 'Legendary');
        return items[Math.floor(Math.random() * items.length)];
    } else if (rand < 0.25) {
        const items = ITEMS.ALL_ITEMS.filter(i => i.rarity === 'Epic');
        return items[Math.floor(Math.random() * items.length)];
    } else if (rand < 0.60) {
        const items = ITEMS.ALL_ITEMS.filter(i => i.rarity === 'Rare');
        return items[Math.floor(Math.random() * items.length)];
    } else {
        const items = ITEMS.ALL_ITEMS.filter(i => i.rarity === 'Common');
        return items[Math.floor(Math.random() * items.length)];
    }
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
            const itemName = user.equipment[slot];
            if (itemName) {
                const info = getItemData(itemName);
                if (info && info.stats) {
                    if (info.stats.atk) atk += info.stats.atk;
                    if (info.stats.def) def += info.stats.def;
                    if (info.stats.hp) hp += info.stats.hp;
                }
            }
        }
    }
    return { atk, def, hp };
}

client.once('ready', () => {
    console.log(`🤖 Minecraft Adventure Discord Bot Online (Firebase Connected)! Login: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const userId = message.author.id;
    const user = await getUser(userId);

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
                { name: "💰 Saldo Koin", value: `${user.coins.toLocaleString('id-ID')} 🪙 (Rp ${(user.coins * 100).toLocaleString('id-ID')})`, inline: true },
                { name: "⚔️ Total Stats Kamu", value: `• ATK: **${stats.atk}**\n• DEF: **${stats.def}**\n• HP Max: **${stats.hp}**`, inline: false },
                { name: "🎽 Gear Terpasang", value: `• Weapon: **${eq.weapon || 'Kosong'}**\n• Armor: **${eq.armor || 'Kosong'}**\n• Helm: **${eq.helm || 'Kosong'}**\n• Boots: **${eq.boots || 'Kosong'}**`, inline: false }
            )
            .setColor(0x3498DB);

        return message.reply({ embeds: [embed] });
    }

    // ==========================================
    // 2. MARKETPLACE (BELI MAKANAN / HEAL)
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

        const itemData = getItemData(itemName);
        if (!itemData || !itemData.buyPrice) {
            return message.reply("❌ Item tersebut tidak tersedia di Marketplace makanan!");
        }

        if (user.coins < itemData.buyPrice) {
            return message.reply(`❌ Koin kamu tidak cukup! Harga **${itemData.name}** adalah **${itemData.buyPrice} Koin**. (Koinmu: ${user.coins})`);
        }

        user.coins -= itemData.buyPrice;
        if (!user.inventory) user.inventory = [];
        user.inventory.push(itemData.name);
        await saveUser(userId, user);

        return message.reply(`✅ Berhasil membeli **${itemData.name}** seharga **${itemData.buyPrice} Koin**! Makanan telah disimpan di inventory.`);
    }

    // ==========================================
    // 3. EQUIP ITEM
    // ==========================================
    if (command === 'equip') {
        const itemName = args.join(" ");
        if (!itemName) return message.reply("❌ Sebutkan item yang ingin dipasang! Contoh: `!equip Diamond Sword 💎`");

        if (!user.inventory || !user.inventory.includes(itemName)) {
            return message.reply("❌ Kamu tidak memiliki item tersebut di inventory!");
        }

        const itemData = getItemData(itemName);
        if (!itemData || !itemData.type || itemData.type === 'consumable') {
            return message.reply("❌ Item ini adalah makanan/consumable dan tidak bisa dipakai sebagai equipment gear!");
        }

        const slot = itemData.type;
        if (!user.equipment) user.equipment = { weapon: null, armor: null, helm: null, boots: null };
        const currentEquipped = user.equipment[slot];

        const index = user.inventory.indexOf(itemName);
        user.inventory.splice(index, 1);

        if (currentEquipped) {
            user.inventory.push(currentEquipped);
        }
        user.equipment[slot] = itemData.name;

        await saveUser(userId, user);
        return message.reply(`✅ Berhasil mengenakan **${itemData.name}** pada slot **${slot.toUpperCase()}**!`);
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
        const targetData = await getUser(targetId);
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

        const itemData = getItemData(itemName);
        if (!itemData) return message.reply(`❌ Item **"${itemName}"** tidak ditemukan!`);

        const targetId = targetUser.id;
        const targetData = await getUser(targetId);
        if (!targetData.inventory) targetData.inventory = [];
        targetData.inventory.push(itemData.name);
        await saveUser(targetId, targetData);

        return message.reply(`✅ Berhasil memberikan **${itemData.name}** ke inventory <@${targetId}>!`);
    }

    // ==========================================
    // 5. TOP-UP INFO
    // ==========================================
    if (command === 'topup') {
        const topupEmbed = new EmbedBuilder()
            .setTitle("💳 MENU TOP-UP KOIN (1 Koin = Rp 100)")
            .setDescription("Isi Koin untuk modal **!hunt**, **!gacha**, **!market**, atau **!slot**!")
            .addFields(
                { name: "💵 Price List", value: "• Rp 10.000 ➔ **100 Koin**\n• Rp 50.000 ➔ **550 Koin**\n• Rp 100.000 ➔ **1.150 Koin**", inline: false },
                { name: "📲 Pembayaran", value: "• **QRIS / E-Wallet:** `0812-XXXX-XXXX`\n• **BCA:** `1234567890 a.n Dev`", inline: false },
                { name: "📌 Konfirmasi", value: "Kirim bukti transfer ke <@" + DEV_ID + ">.", inline: false }
            )
            .setColor(0xF1C40F);

        return message.reply({ embeds: [topupEmbed] });
    }

    // ==========================================
    // 6. SYSTEM HUNT & RISIKO RESET KE LANTAI DASAR
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
                user.floor = 1; // RESET KE LANTAI 1
                await saveUser(userId, user);
                return message.reply(`💀 **KAMU TUMBANG DIHADAPAN BOSS!**\nStats kamu terlalu lemah untuk mengalahkan **${bossData.name}** (HP: ${bossData.hp} | ATK: ${bossData.atk}).\n\n⚠️ *Karaktermu mati dan terlempar keluar dungeon! Progres lantai di-reset kembali ke **Lantai 1**.*`);
            }

            const bossLoot = getRandomItemEqualRate();
            if (!user.inventory) user.inventory = [];
            user.inventory.push(bossLoot.name);
            user.floor += 1;
            await saveUser(userId, user);

            const embed = new EmbedBuilder()
                .setTitle(`⚔️ BOSS FLOOR ${user.floor - 1} DIKALAHKAN! 🐉`)
                .setDescription(`Musuh: **${bossData.name}**\n• HP: \`${bossData.hp}\` | ATK: \`${bossData.atk}\`\n\n🎁 **Hadiah Drop:**\n📦 **${bossLoot.name}**\n⭐ **[ ${bossLoot.rarity} ]**`)
                .setColor(getRarityColor(bossLoot.rarity));

            return message.reply({ embeds: [embed] });
        } else {
            const monsterHp = 30 + (user.floor * 10);
            const monsterAtk = 5 + (user.floor * 3);

            if (pStats.hp <= monsterAtk && pStats.atk < monsterHp / 2) {
                user.floor = 1; // RESET KE LANTAI 1
                await saveUser(userId, user);
                return message.reply(`💀 **KAMU TERBUNUH OLEH MONSTER!**\nLantai ${user.floor} terlalu berbahaya untuk stats kamu saat ini. Progres lantai di-reset kembali ke **Lantai 1**.`);
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
        const gachaResult = rollGacha();
        if (!user.inventory) user.inventory = [];
        user.inventory.push(gachaResult.name);
        await saveUser(userId, user);

        const embed = new EmbedBuilder()
            .setTitle("🎰 Gacha Chest Terbuka!")
            .setDescription(`🎉 Kamu mendapatkan:\n**${gachaResult.name}**\nRarity: **[ ${gachaResult.rarity} ]**`)
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

        const embed = new EmbedBuilder().setTitle("🎰 SLOT KASINO").setDescription(`**[ ${s1} | ${s2} | ${s3} ]**\n\n${res}`).setColor(payout > 0 ? 0x2ECC71 : 0xE74C3C);
        return message.reply({ embeds: [embed] });
    }

    // ==========================================
    // 8. INVENTORY & SELL
    // ==========================================
    if (command === 'inv' || command === 'inventory') {
        const inv = user.inventory || [];
        const invList = inv.length > 0 ? inv.map((item, i) => `${i + 1}. ${item}`).join('\n') : "*Inventory kosong.*";
        const embed = new EmbedBuilder().setTitle(`🎒 Inventory ${message.author.username}`).addFields(
            { name: "💰 Saldo Koin", value: `${user.coins.toLocaleString('id-ID')} 🪙`, inline: true },
            { name: "📜 Item", value: invList }
        ).setColor(0x2ECC71);
        return message.reply({ embeds: [embed] });
    }

    if (command === 'sell') {
        const itemName = args.join(" ");
        const inv = user.inventory || [];
        const idx = inv.indexOf(itemName);
        if (idx === -1) return message.reply("❌ Kamu tidak punya item tersebut!");

        const itemData = getItemData(itemName);
        const val = itemData ? itemData.value : 100;
        user.inventory.splice(idx, 1);
        user.coins += val;
        await saveUser(userId, user);

        return message.reply(`✅ Berhasil menjual **${itemName}** seharga **+${val.toLocaleString('id-ID')} Koin**!`);
    }

    // ==========================================
    // 9. REKBER RMT HOLD
    // ==========================================
    if (command === 'rekber') {
        const buyer = message.mentions.users.first();
        const seller = message.mentions.users.first(2)[1] || message.mentions.users.first();
        if (!buyer || args.length < 3) return message.reply("❌ Format: `!rekber @buyer @seller [Item] [Harga_Rp]`");

        const price = parseInt(args[args.length - 1]);
        const itemName = args.slice(2, args.length - 1).join(" ");
        if (isNaN(price)) return message.reply("❌ Harga harus angka!");

        const sellerId = seller.id;
        const sData = await getUser(sellerId);
        const inv = sData.inventory || [];
        const idx = inv.indexOf(itemName);
        if (idx === -1) return message.reply("❌ Seller tidak memiliki item tersebut!");

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
            txId, sellerId, buyerId: buyer.id, item: itemName, price, status: "WAITING_PAYMENT"
        });

        const embedTicket = new EmbedBuilder().setTitle(`📜 Rekber Official (${txId})`).addFields(
            { name: "Item", value: itemName },
            { name: "Harga", value: `Rp ${price.toLocaleString('id-ID')}` }
        ).setColor(0xE67E22);

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
        const buyerData = await getUser(txData.buyerId);
        if (!buyerData.inventory) buyerData.inventory = [];
        buyerData.inventory.push(txData.item);
        await saveUser(txData.buyerId, buyerData);

        await set(ticketRef, null);
        await interaction.update({ content: "🎉 Transaksi selesai! Item dikirim ke buyer.", embeds: [], components: [] });
        setTimeout(() => interaction.channel.delete().catch(() => {}), 10000);
    } else if (interaction.customId === 'cancel_tx') {
        const sellerData = await getUser(txData.sellerId);
        if (!sellerData.inventory) sellerData.inventory = [];
        sellerData.inventory.push(txData.item);
        await saveUser(txData.sellerId, sellerData);

        await set(ticketRef, null);
        await interaction.update({ content: "❌ Transaksi dibatalkan. Item kembali ke seller.", embeds: [], components: [] });
        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }
});

client.login(process.env.DISCORD_TOKEN);

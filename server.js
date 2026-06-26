const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 1999;

app.use(express.json());
// Mengarahkan server untuk membaca file HTML di dalam folder 'public'
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'data.json');

// Helper untuk membaca dan menulis data
const readData = () => {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE));
};
const writeData = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

// --- API ENDPOINTS ---

// Mengambil semua data link
app.get('/api/projects', (req, res) => {
    res.json(readData());
});

// Menambah link baru
app.post('/api/projects', (req, res) => {
    const { name, url, description } = req.body;
    const apiKey = req.headers['x-api-key'];

    // Cek API Key
    if (apiKey !== 'key') {
        return res.status(403).json({ error: 'Akses ditolak! API Key salah.' });
    }
    
    // --- INI BAGIAN YANG DIPERBAIKI ---
    let data = readData(); // 1. Baca dulu data lama dari file data.json
    
    const newProject = {   // 2. Bungkus data baru yang dikirim dari HP
        id: Date.now().toString(),
        name: name,
        url: url,
        description: description || ""
    };
    
    data.push(newProject); // 3. Masukkan data baru ke dalam antrean
    writeData(data);       // 4. Simpan kembali ke file data.json
    
    res.json(newProject);  // 5. Berikan balasan sukses
});


// Menghapus link
app.delete('/api/projects/:id', (req, res) => {
    let data = readData();
    data = data.filter(p => p.id !== req.params.id);
    writeData(data);
    res.json({ success: true });
});

// Menjalankan server
app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});


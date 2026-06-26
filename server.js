const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

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
    const apiKey = req.headers['x-api-key']; // Membaca key dari header

    // Ganti 'RAHASIA123' dengan password yang kamu mau
    if (apiKey !== 'RAHASIA123') {
        return res.status(403).json({ error: 'Akses ditolak! API Key salah.' });
    }
    
    data.push(newProject);
    writeData(data);
    res.json(newProject);
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


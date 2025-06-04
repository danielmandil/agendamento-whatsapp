require('dotenv').config();
const { db } = require('./firebase-config');

async function listarBarbeiros() {
    try {
        const snapshot = await db.collection('barbers').get();
        console.log(`\n📊 Total de barbeiros: ${snapshot.size}\n`);
        
        snapshot.forEach(doc => {
            console.log('ID:', doc.id);
            console.log('Dados:', doc.data());
            console.log('---');
        });
    } catch (error) {
        console.error('Erro:', error);
    }
}

listarBarbeiros();
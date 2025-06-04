const admin = require('firebase-admin');
const path = require('path');

try {

// Carrega as credenciais do arquivo JSON
const serviceAccount = require('./serviceAccountKey.json');

// Inicializa o Firebase Admin
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID
});

// Referência ao Firestore
const db = admin.firestore();

// Configura timezone para São Paulo
db.settings({
    timestampsInSnapshots: true,
    timezone: 'America/Sao_Paulo'
});

console.log('✅ Firebase conectado com sucesso!');
console.log('📁 Project ID:', process.env.FIREBASE_PROJECT_ID);

module.exports = { admin, db };
} catch (error) {
    console.error('❌ Erro ao conectar Firebase:', error.message);
    throw error;
}
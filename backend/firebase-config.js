const admin = require('firebase-admin');

let serviceAccount;

// No Vercel, usa a variável de ambiente
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.log('🔐 Usando credenciais do ambiente Vercel');
    try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (error) {
        console.error('❌ Erro ao fazer parse do FIREBASE_SERVICE_ACCOUNT:', error);
        throw new Error('FIREBASE_SERVICE_ACCOUNT inválido');
    }
} else if (process.env.NODE_ENV !== 'production') {
    // Apenas em desenvolvimento local
    console.log('🔐 Usando credenciais locais');
    try {
        serviceAccount = require('./serviceAccountKey.json');
    } catch (error) {
        console.error('⚠️ serviceAccountKey.json não encontrado - OK se estiver em produção');
    }
}

if (!serviceAccount) {
    throw new Error('Credenciais do Firebase não encontradas!');
}

// Inicializa o Firebase Admin
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID
});

// Referência ao Firestore
const db = admin.firestore();

console.log('✅ Firebase conectado com sucesso!');
console.log('📁 Project ID:', process.env.FIREBASE_PROJECT_ID);

module.exports = { admin, db };
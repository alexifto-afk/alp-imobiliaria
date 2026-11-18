import webPush from 'web-push';
import crypto from 'node:crypto';
const keys=webPush.generateVAPIDKeys();
console.log('Copie estes valores diretamente para Environment no Render. Não envie em chat nem salve no GitHub.');
console.log('VAPID_PUBLIC_KEY='+keys.publicKey);
console.log('VAPID_PRIVATE_KEY='+keys.privateKey);
console.log('NOTIFICATION_JOB_TOKEN='+crypto.randomBytes(32).toString('hex'));

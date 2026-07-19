#!/usr/bin/env node
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log(`
# Add these to .env (and Liara env vars), then restart the API:
VAPID_PUBLIC_KEY=${keys.publicKey}
VAPID_PRIVATE_KEY=${keys.privateKey}
VAPID_SUBJECT=mailto:admin@pokyplane.local
`);

// ============================================================
// PUSH SUBSCRIBE FLOW — add this into the <script> block in index.html,
// after the notif-prompt code you already added.
// ============================================================

// Paste the PUBLIC VAPID key here (generated in step below). Safe to expose.


const VAPID_PUBLIC_KEY = 'BCF1ZKxia_XUAstPJrcYUqocuUO85i1gXozMtOoBZxJxqB3y7Sihi5cj0UW2cBtiHUQwZhb2UqYDOk9dzC_B090' ;




function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.error('Service worker registration failed:', err);
    return null;
  }
}

async function subscribeToPush() {
  if (!('PushManager' in window)) {
    console.warn('Push not supported in this browser');
    return;
  }
  if (!currentUser) return; // must be signed in to attach a subscription to a user

  const registration = await registerServiceWorker();
  if (!registration) return;

  try {
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true, // required by Chrome: every push must show a visible notification
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const raw = subscription.toJSON();
    const { error } = await supabaseClient.from('push_subscriptions').upsert(
      {
        user_id: currentUser.id,
        endpoint: raw.endpoint,
        p256dh: raw.keys.p256dh,
        auth: raw.keys.auth,
      },
      { onConflict: 'endpoint' }
    );
    if (error) throw error;
    console.log('Push subscription saved');
  } catch (err) {
    console.error('Push subscription failed:', err);
  }
}

// ---- wire it into your existing "Allow notifications" button ----
// Replace your current notifAllowBtn click handler with this version:
document.getElementById('notifAllowBtn').addEventListener('click', async () => {
  document.getElementById('notifOverlay').classList.remove('show');
  try {
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      await subscribeToPush(); // <-- new: actually subscribe once permission is granted
    }
  } catch (err) {
    console.error('Notification permission request failed:', err);
  }
});

// If the user already granted permission in a past session (e.g. returning
// visit), make sure they still have a live subscription saved — call this
// once after loadAuthState() in your init() function:
async function ensurePushSubscriptionIfAlreadyGranted() {
  if ('Notification' in window && Notification.permission === 'granted' && currentUser) {
    await subscribeToPush();
  }
}


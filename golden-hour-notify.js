// golden-hour-notify.js
// Sends the REAL "your Golden Hour question just unblurred" notification —
// a web push via VAPID (sw.js handles display), falling back to a one-off
// email when the recipient has no push subscription or chose email in the
// circle.html "Enable notifications" prompt. Separate from notification-cron.js
// — that file's digest/instant emails for regular posts are untouched.
//
// Runs inside your existing app.js process on Render, same pattern as
// notification-cron.js. Require + start it next to that one:
//   const { startGoldenHourNotifyCron } = require('./golden-hour-notify');
//   startGoldenHourNotifyCron();
//
// Needs: npm install web-push
//
// Env vars required:
//   VAPID_PUBLIC_KEY   — same value baked into subscribe-snippet.js's VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY  — the private half from the same `web-push generate-vapid-keys` run
//   VAPID_SUBJECT       — e.g. 'mailto:you@yourdomain.com'
//   GOLDEN_HOUR_TZ      — IANA timezone Golden Hour's "6pm" is measured in, e.g. 'America/New_York'.
//                         circle.html currently gates on each browser's *local* clock, so this
//                         is a best-effort single reference zone for the server job — if your
//                         users span multiple timezones, "6pm" server-side and "6pm" on their
//                         phone won't always agree. Worth fixing on the client side later if that
//                         matters to you (store the recipient's timezone, gate both ends off it).
//   EMAILJS_SERVICE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY — already set for notification-cron.js
//   EMAILJS_GH_TEMPLATE_ID — a NEW, separate EmailJS template for this notification (don't reuse
//                            EMAILJS_TEMPLATE_ID — that's the regular post digest template)
//   APP_URL — already set for notification-cron.js

require('dotenv').config();
const cron = require('node-cron');
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const GOLDEN_HOUR_END_HOUR = 18; // 6pm — keep in sync with GOLDEN_HOUR_END in circle.html
const GH_TZ = process.env.GOLDEN_HOUR_TZ || 'UTC';

// Hour-of-day (0-23) for `date`, as it reads in `timeZone` — used instead of
// Date#getHours() so this doesn't silently run on the server container's
// own local time (Render defaults to UTC).
function hourInTZ(date, timeZone){
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).formatToParts(date);
  const h = parts.find(p => p.type === 'hour')?.value;
  return h === '24' ? 0 : parseInt(h, 10);
}

function isPastGoldenHourEnd(createdAtIso){
  const created = new Date(createdAtIso);
  const now = new Date();
  // Same calendar day (in GH_TZ) and now's hour has reached 6pm, OR any
  // later day entirely (covers a prompt that somehow never got picked up
  // same-day — still deliver it rather than lose it silently).
  const createdDay = new Intl.DateTimeFormat('en-CA', { timeZone: GH_TZ }).format(created);
  const nowDay = new Intl.DateTimeFormat('en-CA', { timeZone: GH_TZ }).format(now);
  if (nowDay > createdDay) return true;
  if (nowDay < createdDay) return false;
  return hourInTZ(now, GH_TZ) >= GOLDEN_HOUR_END_HOUR;
}

async function sendGoldenHourPush(subRow, payload){
  const subscription = {
    endpoint: subRow.endpoint,
    keys: { p256dh: subRow.p256dh, auth: subRow.auth },
  };
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410){
      // Subscription is dead (uninstalled, expired) — stop trying it.
      await supabase.from('push_subscriptions').delete().eq('endpoint', subRow.endpoint);
    } else {
      console.error('[gh-notify] push send failed', err.statusCode, err.body || err.message);
    }
    return false;
  }
}

async function sendGoldenHourEmail({ to_email, to_name, circle_name, circle_id, prompt_id, asker_label, question_preview }){
  const templateParams = {
    to_email,
    to_name,
    circle_name,
    asker_label,
    question_preview,
    post_url: `${process.env.APP_URL}/circle?private&ID=${circle_id}&prompt=${prompt_id}`,
  };
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: process.env.EMAILJS_SERVICE_ID,
      template_id: process.env.EMAILJS_GH_TEMPLATE_ID,
      user_id: process.env.EMAILJS_PUBLIC_KEY,
      accessToken: process.env.EMAILJS_PRIVATE_KEY,
      template_params: templateParams,
    }),
  });
  if (!res.ok) throw new Error(`EmailJS gh send failed (${res.status}): ${await res.text()}`);
}

async function runGoldenHourNotify(){
  const { data: prompts, error } = await supabase
    .from('golden_hour_prompts')
    .select('id, from_user_id, to_user_id, circle_id, question, created_at, is_anonymous')
    .is('answered_at', null)
    .is('notified_at', null);
  if (error){ console.error('[gh-notify] fetch failed', error); return; }
  if (!prompts || prompts.length === 0) return;

  const due = prompts.filter(p => isPastGoldenHourEnd(p.created_at));
  if (due.length === 0) return;

  const toUserIds = [...new Set(due.map(p => p.to_user_id))];
  const fromUserIds = [...new Set(due.map(p => p.from_user_id))];
  const circleIds = [...new Set(due.map(p => p.circle_id))];

  const [{ data: recipientProfiles }, { data: askerProfiles }, { data: circles }, { data: subs }] = await Promise.all([
    supabase.from('profiles').select('id, username, gh_notify_channel').in('id', toUserIds),
    supabase.from('profiles').select('id, username').in('id', fromUserIds),
    supabase.from('circles').select('id, name').in('id', circleIds),
    supabase.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', toUserIds),
  ]);

  const recipientById = new Map((recipientProfiles || []).map(r => [r.id, r]));
  const askerById = new Map((askerProfiles || []).map(a => [a.id, a]));
  const circleById = new Map((circles || []).map(c => [c.id, c]));
  const subsByUser = new Map();
  (subs || []).forEach(s => {
    if (!subsByUser.has(s.user_id)) subsByUser.set(s.user_id, []);
    subsByUser.get(s.user_id).push(s);
  });

  // Emails come from auth, not the profiles table — fetched per unique
  // recipient, not per prompt, to keep this cheap.
  const emailByUserId = new Map();
  for (const uid of toUserIds){
    const { data, error: userErr } = await supabase.auth.admin.getUserById(uid);
    if (!userErr && data?.user?.email) emailByUserId.set(uid, data.user.email);
  }

  for (const p of due){
    const recipient = recipientById.get(p.to_user_id);
    if (!recipient) continue;

    const asker = askerById.get(p.from_user_id);
    // Same rule as the client: never reveal the real name if sent anonymously.
    const askerLabel = p.is_anonymous ? 'Anonymous' : (asker?.username || 'Someone');
    const circle = circleById.get(p.circle_id);
    const questionPreview = p.question.length > 80 ? p.question.slice(0, 77) + '…' : p.question;
    const url = `${process.env.APP_URL}/circle?private&ID=${p.circle_id}&prompt=${p.id}`;

    let delivered = false;
    const wantsPush = recipient.gh_notify_channel === 'push';
    const userSubs = subsByUser.get(p.to_user_id) || [];

    if (wantsPush && userSubs.length > 0){
      const payload = {
        title: 'Golden Hour revealed 🌇',
        body: `${askerLabel}'s question to you is unblurred now.`,
        url,
        tag: `gh-${p.id}`,
      };
      const results = await Promise.all(userSubs.map(s => sendGoldenHourPush(s, payload)));
      delivered = results.some(Boolean);
    }

    if (!delivered){
      const email = emailByUserId.get(p.to_user_id);
      if (email){
        try {
          await sendGoldenHourEmail({
            to_email: email,
            to_name: recipient.username || 'there',
            circle_name: circle?.name || 'your circle',
            circle_id: p.circle_id,
            prompt_id: p.id,
            asker_label: askerLabel,
            question_preview: questionPreview,
          });
          delivered = true;
        } catch (e) {
          console.error('[gh-notify] email send failed for', email, e.message);
        }
      }
    }

    if (delivered){
      const { error: updateErr } = await supabase
        .from('golden_hour_prompts')
        .update({ notified_at: new Date().toISOString() })
        .eq('id', p.id);
      if (updateErr) console.error('[gh-notify] failed to mark notified_at', updateErr);
      console.log(`[gh-notify] delivered for prompt ${p.id} to ${recipient.username || p.to_user_id} via ${wantsPush && userSubs.length > 0 ? 'push' : 'email'}`);
    } else {
      console.error(`[gh-notify] could not deliver for prompt ${p.id} — no push subscription and no email on file`);
    }
  }
}

function startGoldenHourNotifyCron(){
  // Every minute — the reveal moment is time-critical, unlike the
  // 5-minute/4-hour windows notification-cron.js uses for post digests.
  cron.schedule('* * * * *', runGoldenHourNotify);
  console.log('Golden Hour notify cron started: checking every minute.');
}

module.exports = { startGoldenHourNotifyCron };
// notification-cron.js
// The REAL notification job. Runs inside your existing app.js process on
// Render — no separate deployment needed.

require('dotenv').config();
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const timeAgo = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

function buildHeadline(posterName, caption) {
  if (caption && caption.trim().length > 0) {
    return caption.trim().length > 60 ? caption.trim().slice(0, 57) + '…' : caption.trim();
  }
  return `${posterName} just added a new moment`;
}

async function sendOneEmail({ to_email, to_name, circle_name, circle_id, notify_token, hero, extraCount, extraNames }) {
  const templateParams = {
    to_email,
    to_name,
    circle_name,
    poster_name: hero.poster_name,
    poster_avatar_url: hero.poster_avatar_url || '',
    post_thumbnail_url: hero.media_url,
    post_url: `${process.env.APP_URL}/circle?private&ID=${circle_id}&post=${hero.id}`,
    headline_text: buildHeadline(hero.poster_name, hero.caption),
    caption_preview: hero.caption || '',
    post_time_ago: timeAgo(hero.created_at),
    extra_posts_line: extraCount > 0 ? `+ ${extraCount} more from ${extraNames.join(', ')}` : '',
    preheader_text: `${hero.poster_name} shared something new in ${circle_name}`,
    notification_settings_url: `${process.env.APP_URL}/notify-settings?t=${notify_token}`,
    unsubscribe_url: `${process.env.APP_URL}/unsubscribe?t=${notify_token}`
  };

  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: process.env.EMAILJS_SERVICE_ID,
      template_id: process.env.EMAILJS_TEMPLATE_ID,
      user_id: process.env.EMAILJS_PUBLIC_KEY,
      accessToken: process.env.EMAILJS_PRIVATE_KEY,
      template_params: templateParams
    })
  });

  if (!res.ok) throw new Error(`EmailJS send failed (${res.status}): ${await res.text()}`);
}

async function runBatch(frequency, minAgeInterval) {
  const { data: rows, error } = await supabase.rpc('get_pending_notifications', {
    p_frequency: frequency,
    p_min_age: minAgeInterval
  });
  if (error) { console.error(`[${frequency}] get_pending_notifications failed`, error); return; }
  if (!rows || rows.length === 0) { console.log(`[${frequency}] nothing pending`); return; }

  for (const row of rows) {
    const { data: posts, error: postsErr } = await supabase
      .from('posts')
      .select('id, caption, media_url, created_at, user_id, profiles!posts_user_id_fkey(username, avatar_url)')
      .in('id', row.post_ids)
      .order('created_at', { ascending: false });

    if (postsErr || !posts || posts.length === 0) continue;

    const [heroRaw, ...rest] = posts;
    const hero = {
      id: heroRaw.id,
      caption: heroRaw.caption,
      media_url: heroRaw.media_url,
      created_at: heroRaw.created_at,
      poster_name: heroRaw.profiles?.username || 'Someone',
      poster_avatar_url: heroRaw.profiles?.avatar_url
    };
    const extraNames = [...new Set(rest.map(p => p.profiles?.username).filter(Boolean))];

    try {
      await sendOneEmail({
        to_email: row.recipient_email,
        to_name: row.recipient_name,
        circle_name: row.circle_name,
        circle_id: row.circle_id,
        notify_token: row.notify_token,
        hero,
        extraCount: rest.length,
        extraNames
      });

      const inserts = row.post_ids.map(pid => ({ post_id: pid, recipient_id: row.recipient_id }));
      const { error: insertErr } = await supabase
        .from('post_notifications')
        .upsert(inserts, { onConflict: 'post_id,recipient_id' });
      if (insertErr) console.error('failed to record sent notifications', insertErr);

      console.log(`[${frequency}] sent to ${row.recipient_email} for ${row.circle_name}`);
    } catch (e) {
      console.error(`[${frequency}] send failed for ${row.recipient_email}:`, e.message);
    }
  }
}

function startNotificationCron() {
  // Every 5 minutes: instant subscribers, 5-min coalescing window.
  cron.schedule('*/5 * * * *', () => runBatch('instant', '5 minutes'));

  // Every 4 hours: digest subscribers.
  cron.schedule('0 */4 * * *', () => runBatch('digest', '4 hours'));

  console.log('Notification cron started: instant every 5 min, digest every 4 hrs.');
}

module.exports = { startNotificationCron };
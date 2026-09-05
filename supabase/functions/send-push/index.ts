// supabase/functions/send-push/index.ts
//
// Deploy with:
//   supabase functions deploy send-push
//
// Then create a Database Webhook (Database → Webhooks in the Supabase
// dashboard) for INSERT on both `likes` and `comments` tables, pointing at
// this function's URL. Supabase will POST the new row as { record: {...} }.
//
// Secrets needed (set with `supabase secrets set`):
//   VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY
//   VAPID_SUBJECT        e.g. mailto:you@yourdomain.com
//   SUPABASE_URL              (auto-available in Edge Functions)
//   SUPABASE_SERVICE_ROLE_KEY (set manually — needed to read across all users, bypassing RLS)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'https://esm.sh/web-push@3.6.7';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, serviceRoleKey);

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT')!,
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!
);

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const { table, record } = payload; // Supabase webhook includes "table"

    // ---- figure out who should be notified, and what the message says ----
    let postOwnerId: string | null = null;
    let actorId: string | null = null;
    let title = 'Waater';
    let body = '';
    let url = '/';

    if (table === 'likes') {
      actorId = record.user_id;
      const { data: post } = await supabase
        .from('posts')
        .select('user_id')
        .eq('id', record.post_id)
        .maybeSingle();

      postOwnerId = post?.user_id ?? null;

      title = 'Congratulations🎉🎉 Someone liked your post ';

      body = 'Someone liked your post Tap to find Out👀👀';

      url = `/post?id=${record.post_id}`;

    } else if (table === 'comments') {
      actorId = record.user_id;
      const { data: post } = await supabase
        .from('posts')

        .select('user_id')

        .eq('id', record.post_id)

        .maybeSingle();


      postOwnerId = post?.user_id ?? null;

      title = 'You Got a new comment👏👏';

      body = record.body?.slice(0, 120) || 'Someone commented on your post';

      url = `/post?id=${record.post_id}`;
    } else {
      return new Response(JSON.stringify({ skipped: true }), { status: 200 });
    }

    // don't notify people about their own likes/comments on their own post
    if (!postOwnerId || postOwnerId === actorId) {
      return new Response(JSON.stringify({ skipped: true }), { status: 200 });
    }

    // ---- look up the actor's display name for a nicer message ----
    const { data: actorProfile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', actorId)

      .maybeSingle();

    if (actorProfile?.username) {
      body = table === 'likes'
      
        ? `${actorProfile.username} liked your post`
        
        : `${actorProfile.username}: ${body}`;
    }

    // ---- fetch all of the post owner's push subscriptions (multi-device) ----
    const { data: subs, error: subsError } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', postOwnerId);
    if (subsError) throw subsError;
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
    }

    const notifPayload = JSON.stringify({ title, body, url, tag: `post-${record.post_id}` });

    const results = await Promise.allSettled(
      subs.map((sub) =>
        webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          notifPayload
        )
      )
    );

    // clean up subscriptions the push service says are dead (410 Gone / 404)
    await Promise.all(
      results.map((r, i) => {
        if (r.status === 'rejected' && (r.reason?.statusCode === 410 || r.reason?.statusCode === 404)) {
          return supabase.from('push_subscriptions').delete().eq('id', subs[i].id);
        }
        return Promise.resolve();
      })

    );

    return new Response(JSON.stringify({ sent: results.filter((r) => r.status === 'fulfilled').length }), {
      status: 200,

    });
  } catch (err) {
    console.error('send-push error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});


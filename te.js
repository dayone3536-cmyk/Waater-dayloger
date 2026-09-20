// ============================================================
// WAATER — one-off test send
// Run: node 04-test-send-email.js
// Fill in the 4 values below first, then run it and paste me
// whatever prints in your terminal.
// ============================================================

const EMAILJS_SERVICE_ID  = 'service_echffxm';
const EMAILJS_TEMPLATE_ID = 'template_idwr0ek';
const EMAILJS_PUBLIC_KEY  = 'Uy1rf2bLn34vW9KqQ';
const EMAILJS_PRIVATE_KEY = 'C1BlMYn-WKUotYzR22xd5';

const TEST_TO_EMAIL = 'dayone3536@gmail.com'; // send it to yourself first

async function main() {
  const templateParams = {
    to_email: TEST_TO_EMAIL,
    to_name: 'Vighnesh',
    circle_name: 'Weekend Trip',
    poster_name: 'Meera',
    poster_avatar_url: 'https://placehold.co/100x100',
    post_thumbnail_url: 'https://placehold.co/560x340',
    post_url: 'https://waater-dayloger.onrender.com/circle?private&ID=test123',
    headline_text: 'Meera just clipped a sunset from the trip',
    caption_preview: 'best view all week honestly',
    post_time_ago: '12m ago',
    extra_posts_line: '+ 2 more from Alex, Priya',
    preheader_text: 'Meera shared something new in Weekend Trip',
    notification_settings_url: 'https://waater-dayloger.onrender.com/notify-settings?t=test-token',
    unsubscribe_url: 'https://waater-dayloger.onrender.com/unsubscribe?t=test-token'
  };

  console.log('Sending test email to', TEST_TO_EMAIL, '…');

  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      accessToken: EMAILJS_PRIVATE_KEY,
      template_params: templateParams
    })
  });

  const text = await res.text();

  if (res.ok) {
    console.log('✅ SUCCESS —', res.status, text);
    console.log('Check', TEST_TO_EMAIL, 'for the email.');
  } else {
    console.log('❌ FAILED —', res.status, text);
  }
}

main();
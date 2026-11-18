const { Resend } = require('resend');

// Escape text before putting it inside HTML (a name like "<b>" must not become markup).
const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));

const getResend = () => {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not set in .env');
  }
  return new Resend(process.env.RESEND_API_KEY);
};

// The default sender until you verify your own domain
const getSender = () => process.env.RESEND_FROM || 'AceySecure <onboarding@resend.dev>';

// Generic send function
const sendEmail = async ({ to, subject, html, text }) => {
  const resend = getResend();
  const { error } = await resend.emails.send({
    from: getSender(),
    to,
    subject,
    html,
    text,
  });
  if (error) throw new Error(error.message || 'Resend rejected the email');
};

// The verification email: AceySecure colours, big 6-digit code.
const buildOtpEmail = ({ name, otp, minutes }) => {
  const safeName = escapeHtml(name || 'there');
  const subject = `${otp} is your AceySecure verification code`;

  const text = [
    `Hi ${name || 'there'},`,
    '',
    `Your AceySecure verification code is: ${otp}`,
    `It expires in ${minutes} minutes.`,
    '',
    'If you did not create an AceySecure account, you can ignore this email.',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f3f3;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f3f3;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;">
            <tr>
              <td style="background:#000000;padding:22px 28px;border-bottom:4px solid #E65100;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:800;">
                <span style="color:#ffffff;">Acey</span><span style="color:#E65100;">Secure</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 28px 8px;font-family:Arial,Helvetica,sans-serif;color:#000000;">
                <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;">Verify your email</h1>
                <p style="margin:0;font-size:16px;line-height:1.6;color:#333333;">
                  Hi ${safeName}, use this code to finish creating your account:
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:20px 28px;">
                <div style="display:inline-block;background:#000000;color:#ffffff;font-family:'Courier New',Courier,monospace;font-size:38px;font-weight:700;letter-spacing:10px;padding:16px 16px 16px 26px;">
                  ${otp}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#555555;">
                <p style="margin:0 0 12px;">This code expires in <strong style="color:#000000;">${minutes} minutes</strong>. Never share it with anyone.</p>
                <p style="margin:0;">If you did not create an AceySecure account, you can safely ignore this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
};

const sendOtpEmail = async ({ to, name, otp, minutes = 10 }) => {
  const { subject, html, text } = buildOtpEmail({ name, otp, minutes });
  await sendEmail({ to, subject, html, text });
};

// ---------- Admin alert: "you have a new order" ----------

const formatMoney = (value, currency = 'NGN') => {
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency }).format(Number(value) || 0);
  } catch {
    return `${currency} ${Number(value) || 0}`;
  }
};

const buildAdminAlert = (order) => {
  const customer = order.customer || {};
  const items = Array.isArray(order.orderItems) ? order.orderItems : [];
  const currency = order.currency || 'NGN';
  const total = formatMoney(order.totalPrice, currency);

  const isTest = String(order.reference || '').startsWith('MOCK-');
  const statusLabel = isTest
    ? 'TEST ORDER (mock payment, nobody was charged)'
    : order.status === 'paid'
      ? 'PAID'
      : 'AWAITING PAYMENT (not confirmed yet)';

  const frontend = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  const ordersUrl = `${frontend}/admin/orders`;
  const placed = new Date(order.createdAt || Date.now()).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const subject = `${isTest ? '[TEST] ' : ''}New order ${order.reference}: ${total}${
    !isTest && order.status !== 'paid' ? ' (awaiting payment)' : ''
  }`;

  const text = [
    `New order ${order.reference}`,
    `Status: ${statusLabel}`,
    `Placed: ${placed}`,
    '',
    `Customer: ${customer.name}`,
    `Phone: ${customer.phone}`,
    `Email: ${customer.email}`,
    `Address: ${customer.address}`,
    '',
    'Items:',
    ...items.map(
      (item) =>
        `- ${item.quantity} x ${item.name} @ ${formatMoney(item.price, currency)} = ${formatMoney(item.price * item.quantity, currency)}`
    ),
    '',
    `Total: ${total}`,
    '',
    `See all orders: ${ordersUrl}`,
  ].join('\n');

  const rows = items
    .map(
      (item) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #e5e5e5;">${escapeHtml(item.name)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #e5e5e5;text-align:center;">${escapeHtml(item.quantity)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #e5e5e5;text-align:right;">${escapeHtml(formatMoney(item.price * item.quantity, currency))}</td>
      </tr>`
    )
    .join('');

  const badgeColor = isTest ? '#555555' : order.status === 'paid' ? '#17702f' : '#E65100';

  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f3f3;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f3f3;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;">
            <tr>
              <td style="background:#000000;padding:20px 28px;border-bottom:4px solid #E65100;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:800;">
                <span style="color:#ffffff;">Acey</span><span style="color:#E65100;">Secure</span>
                <span style="color:#bdbdbd;font-size:14px;font-weight:400;"> &nbsp;New order</span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px 8px;font-family:Arial,Helvetica,sans-serif;color:#000000;">
                <p style="margin:0 0 6px;font-size:13px;color:#555555;">Order ${escapeHtml(order.reference)}, placed ${escapeHtml(placed)}</p>
                <p style="margin:0 0 16px;"><span style="display:inline-block;background:${badgeColor};color:#ffffff;font-size:12px;font-weight:700;padding:4px 10px;">${escapeHtml(statusLabel)}</span></p>
                <h2 style="margin:0 0 8px;font-size:16px;">Customer</h2>
                <p style="margin:0;font-size:15px;line-height:1.6;">
                  <strong>${escapeHtml(customer.name)}</strong><br>
                  Phone: <a href="tel:${escapeHtml(customer.phone)}" style="color:#000000;">${escapeHtml(customer.phone)}</a><br>
                  Email: ${escapeHtml(customer.email)}<br>
                  Address: ${escapeHtml(customer.address)}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 8px;font-family:Arial,Helvetica,sans-serif;color:#000000;">
                <h2 style="margin:0 0 8px;font-size:16px;">Items</h2>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
                  <tr>
                    <th align="left" style="padding-bottom:6px;color:#555555;font-weight:600;">Product</th>
                    <th style="padding-bottom:6px;color:#555555;font-weight:600;">Qty</th>
                    <th align="right" style="padding-bottom:6px;color:#555555;font-weight:600;">Amount</th>
                  </tr>
                  ${rows}
                </table>
                <p style="margin:14px 0 0;font-size:18px;font-weight:700;text-align:right;">Total: ${escapeHtml(total)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px 28px;font-family:Arial,Helvetica,sans-serif;">
                <a href="${escapeHtml(ordersUrl)}" style="display:inline-block;background:#E65100;color:#000000;font-weight:700;font-size:15px;padding:12px 20px;text-decoration:none;">View all orders</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
};

const sendAdminAlert = async (order) => {
  const { ADMIN_EMAIL } = process.env;
  if (!ADMIN_EMAIL) {
    console.warn('[admin alert skipped] Set ADMIN_EMAIL in .env to get an email for each order.');
    return;
  }

  const recipients = ADMIN_EMAIL.split(',').map((address) => address.trim()).filter(Boolean);
  const { subject, html, text } = buildAdminAlert(order);

  await sendEmail({ to: recipients, subject, html, text });
};

module.exports = { sendEmail, sendOtpEmail, sendAdminAlert };
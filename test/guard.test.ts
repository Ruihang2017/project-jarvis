const { redact, sensitiveReason, describeRemoved, redactDeep } = await import("../src/privacy/guard.js");

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);

// [input, category expected to be removed, text that must NOT survive]
const MUST: [string, string, string][] = [
  ["my card is 4111 1111 1111 1111 thanks", "card", "1111 1111 1111"],
  ["卡号4532015112830366", "card", "4532015112830366"],
  ["Visa 4111-1111-1111-1111", "card", "4111-1111"],
  ["全角卡号 ４１１１１１１１１１１１１１１１", "card", "１１１１１１"],
  ["my ANZ card ending 4409 was charged", "card", "4409"],
  ["account ending in 4409", "bank", "4409"],
  ["信用卡尾号4409", "card", "4409"],
  ["尾号是 4409 的那张卡", "card", "4409"],
  ["卡的后四位：4409", "card", "4409"],
  ["last 4 digits 4409", "card", "4409"],
  ["**** **** **** 4409", "card", "4409"],
  ["XXXX-XXXX-XXXX-4409", "card", "4409"],
  ["CVV 123", "card", "123"],
  ["expiry 08/27", "card", "08/27"],
  ["BSB 062-000 account 12345678", "bank", "12345678"],
  ["062-000 12345678", "bank", "12345678"],
  ["BSB: 062000", "bank", "062000"],
  ["我的账号是 1234 5678", "bank", "1234 5678"],
  ["Account number: 2003 4567 89", "bank", "4567"],
  ["acct no. 98765432", "bank", "98765432"],
  ["Customer number 5551234", "bank", "5551234"],
  ["BPAY ref 1234567890", "bank", "1234567890"],
  ["客户号：88001234", "bank", "88001234"],
  ["NMI 4103123456", "bank", "4103123456"],
  ["password: hunter2", "secret", "hunter2"],
  ["我的密码是 Abc!2345", "secret", "Abc!2345"],
  ["密码：qwerty，别告诉别人", "secret", "qwerty"],
  ["PIN 4821", "secret", "4821"],
  ["my pin is 4821", "secret", "4821"],
  ["验证码 739201", "secret", "739201"],
  ["Your verification code is 739201", "secret", "739201"],
  ["OTP: 739201", "secret", "739201"],
  ["key sk-abcdefghijklmnopqrstuvwx", "secret", "sk-abcdefghij"],
  ["TFN 123 456 782", "tfn", "456 782"],
  ["123 456 782", "tfn", "456 782"],
  ["我的税号是123456782", "tfn", "123456782"],
  ["Medicare 2123 45670 1", "medicare", "45670"],
  ["2123 45670 1", "medicare", "45670"],
  ["医保卡号 2123456701", "medicare", "2123456701"],
  ["passport number PA1234567", "passport", "PA1234567"],
  ["护照号 E12345678", "passport", "E12345678"],
  ["driver licence 12345678", "licence", "12345678"],
  ["驾照号码：NSW 1234 5678", "licence", "5678"],
];

const MUST_NOT: string[] = [
  "Meeting on 2026-10-02 at 09:30",
  "Total due $1,234.56 by 15 Oct",
  "AWS bill A$2.49",
  "Call me on 0412 345 678",
  "Postcode 2031, 12 Example St Springfield",
  "Order number 112-3456789-1234567",
  "Tracking number 1Z999AA10123456784",
  "Flight QF1 departs 21:15",
  "ABN 51 824 753 556",
  "The year 2026 was good",
  "账户余额 12345 元",
  "account balance 5000",
  "Invoice #123456",
  "the code is fine",
  "Never store passwords, PINs or card numbers",
  "Spin class at 18:00, pinned message",
  "Ford Everest Sport $58,990, 85,709 km",
  "Thread 019a5b2c-7d3e-7f00-8a11-223344556677",
  "Reply-To: <CAF1234567890@mail.gmail.com>",
  "alex2017@example.com",
  "Room 1203, level 12",
  "Connected Google account: alex2017@example.com.", // digits inside an email/username (2026-10-02 false positive)
  "card holder abc12345",
  "account handle user_2024",
];

for (const [input, category, gone] of MUST) {
  const r = redact(input);
  ok(`removes ${category}: ${input}`, r.removed.includes(category as never) && !r.text.includes(gone), `${JSON.stringify(r)}`);
}
for (const input of MUST_NOT) {
  const r = redact(input);
  ok(`keeps: ${input}`, r.removed.length === 0 && r.text === input, JSON.stringify(r));
}

const r = redact("Card ending 4409 and account 12345678");
ok("replacement text says what was removed", r.text === "Card ending [removed: card number] and account [removed: bank/account number]", r.text);
ok("describe removed", describeRemoved(["card", "bank", "bank"]) === "1 card number and 2 bank/account numbers", describeRemoved(["card", "bank", "bank"]));
ok("sensitive reason", sensitiveReason("我的密码是 abc123") === "password/PIN/code" && sensitiveReason("hello") === null);
const deep = redactDeep({ contentItems: [{ type: "inputText", text: "PIN 4821" }], success: true });
ok("deep redaction of replies", JSON.stringify(deep.value) === JSON.stringify({ contentItems: [{ type: "inputText", text: "PIN [removed: password/PIN/code]" }], success: true }) && deep.removed.length === 1, JSON.stringify(deep));

console.log(results.map(([n, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${n}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;

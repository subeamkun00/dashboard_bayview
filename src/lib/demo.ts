import type { Workspace, Chat, Document, Employee } from "./types";

const names = [
  "Nattapong S.",
  "Sirilak W.",
  "Pimchanok K.",
  "Thanawat P.",
  "Araya M.",
  "Kittipong T.",
  "Chutima R.",
  "Phanupong L.",
  "Suthida N.",
  "Worawut J.",
  "Ananya C.",
  "Somchai B.",
];
const departments = [
  "Front Office",
  "Housekeeping",
  "Human Resources",
  "Food & Beverage",
  "Engineering",
  "Sales & Marketing",
];
export const questionBank = [
  {
    question: "What is the procedure for guest check-in?",
    ai_response:
      "Welcome the guest and confirm their reservation. Verify their ID or passport, confirm the room type and length of stay, and collect the required deposit. Complete registration, issue the room key, and explain breakfast hours, Wi-Fi access, and hotel amenities. Offer luggage assistance before directing the guest to their room.",
    source_document: "Front Office SOP.pdf",
    category: "Operations",
  },
  {
    question: "How do I apply for annual leave?",
    ai_response:
      "Submit your leave request through the employee portal at least 7 days in advance. Select your dates and leave type, then send it to your department manager for approval. HR will update your remaining leave balance once the request is approved. Check the leave calendar with your supervisor before making travel arrangements.",
    source_document: "Employee Handbook.pdf",
    category: "HR & Policies",
  },
  {
    question: "What are the steps for room cleaning?",
    ai_response:
      "Knock and announce housekeeping before entering. Open the curtains, remove waste and used linen, and inspect the room for lost property. Clean and sanitize the bathroom, make the bed with fresh linen, dust surfaces, replenish amenities, and vacuum. Complete the room inspection checklist and update the room status with Front Office.",
    source_document: "Housekeeping SOP.pdf",
    category: "Operations",
  },
  {
    question: "What should I do if a guest has a complaint?",
    ai_response:
      "Listen carefully and acknowledge the guest’s concern. Apologize for the inconvenience, record the details, and offer a solution within your authority. If further support is needed, contact the duty manager. Follow up with the guest and log the resolution in the guest service system.",
    source_document: "Guest Service Standards.pdf",
    category: "Guest Services",
  },
  {
    question: "When is the next staff training session?",
    ai_response:
      "The staff training calendar is maintained by the Training team and shared on the employee noticeboard. Contact your department trainer for the next session and registration details. Mandatory onboarding sessions take place during the first week of employment.",
    source_document: "Training Guide.pdf",
    category: "Training",
  },
  {
    question: "What is the hotel emergency evacuation procedure?",
    ai_response:
      "Raise the alarm and contact the emergency coordinator. Guide guests to the nearest safe emergency exit using the posted evacuation routes. Do not use elevators. Proceed to the designated assembly point, report to your department head, and do not re-enter until the emergency coordinator confirms it is safe.",
    source_document: "Safety & Emergency Policy.pdf",
    category: "Safety",
  },
  {
    question: "What are the breakfast service hours?",
    ai_response:
      "Breakfast is served daily from 6:30 AM to 10:30 AM at the main restaurant. Verify the guest’s room number and breakfast inclusion before seating. For early departures, coordinate a breakfast box with the kitchen in advance.",
    source_document: "Food & Beverage SOP.pdf",
    category: "Guest Services",
  },
  {
    question: "How can I reset my staff account password?",
    ai_response:
      "Open the employee portal and select “Forgot password”. Enter your work email and follow the reset link. If you cannot access your email or do not receive a link, contact the IT help desk with your employee ID. Never share your password with anyone.",
    source_document: "IT Support Guide.pdf",
    category: "IT Support",
  },
];

export function createDemoData(): Workspace {
  const now = new Date();
  const dateAgo = (days: number, hours = 0) =>
    new Date(now.getTime() - days * 86400000 - hours * 3600000).toISOString();
  const users: Employee[] = Array.from({ length: 248 }, (_, i) => ({
    id: `user-${i + 1}`,
    line_user_id: `U${(i + 1).toString(16).padStart(32, "0")}`,
    claimed_at: dateAgo(60 + (i % 120)),
    display_name:
      i < 12
        ? names[i]
        : `${names[i % names.length].split(" ")[0]} ${String.fromCharCode(65 + (i % 26))}.`,
    profile_image_url: null,
    department: departments[i % departments.length],
    nickname: [
      "Nat",
      "Fon",
      "May",
      "Ton",
      "Aya",
      "Kit",
      "Mint",
      "Pong",
      "Nida",
      "Wut",
      "Ann",
      "Chai",
    ][i % 12],
    position: [
      "Receptionist",
      "Room attendant",
      "HR coordinator",
      "Restaurant attendant",
      "Technician",
      "Sales coordinator",
    ][i % departments.length],
    access_enabled: i % 25 !== 24,
    first_seen: dateAgo(60 + (i % 120)),
    last_seen: dateAgo(i < 186 ? i % 7 : 10 + (i % 30), i % 12),
    status: i < 216 ? "active" : "inactive",
    created_at: dateAgo(60 + (i % 120)),
  }));
  const dailyCounts = Array.from({ length: 90 }, (_, day) =>
    day === 0
      ? 486
      : Math.round(
          235 +
            Math.sin(day * 1.2) * 72 +
            Math.cos(day * 0.42) * 55 +
            (day < 15 ? 90 : 0),
        ),
  );
  const chats: Chat[] = Array.from({ length: 12864 }, (_, i): Chat => {
    let day = 0;
    let remaining = i;
    while (day < dailyCounts.length - 1 && remaining >= dailyCounts[day]) {
      remaining -= dailyCounts[day];
      day++;
    }
    const stamp = new Date(now);
    stamp.setDate(stamp.getDate() - day);
    if (day === 0)
      stamp.setTime(
        now.getTime() -
          Math.floor(
            (i / 486) *
              (now.getTime() -
                new Date(
                  now.getFullYear(),
                  now.getMonth(),
                  now.getDate(),
                ).getTime()),
          ),
      );
    else stamp.setHours(7 + (i % 15), i % 60, 0, 0);
    const question =
      questionBank[(i * 7 + Math.floor(i / 5)) % questionBank.length];
    return {
      ...question,
      id: `chat-${i + 1}`,
      user_id: `user-${i < 12 ? i + 1 : i % 7 === 0 ? (i % 12) + 1 : (i % (day <= 7 ? 186 : 248)) + 1}`,
      response_status:
        i % 83 === 82 ? "failed" : i % 37 === 36 ? "fallback" : "success",
      ai_response:
        i % 83 === 82
          ? "The assistant could not generate a response. The workflow logged this request for review."
          : i % 37 === 36
            ? "❌ ไม่พบข้อมูลในระบบ\n\nกรุณาติดต่อหัวหน้าแผนกของคุณ หรือรอการตอบกลับจากแอดมิน 🙏\nเราได้ส่งคำถามนี้ให้แอดมินแล้ว"
            : question.ai_response,
      created_at: stamp.toISOString(),
    };
  }).sort((a, b) => b.created_at.localeCompare(a.created_at));
  users.forEach((user) => {
    const latest = chats.find((chat) => chat.user_id === user.id);
    if (latest) user.last_seen = latest.created_at;
  });
  const documents: Document[] = questionBank.map((q, i) => ({
    id: `doc-${i + 1}`,
    document_name: q.source_document,
    original_filename: q.source_document,
    department: [
      "Front Office",
      "Human Resources",
      "Housekeeping",
      "Front Office",
      "Training",
      "Engineering",
      "Food & Beverage",
      "IT",
    ][i],
    uploaded_by: "demo-admin",
    uploaded_by_name: "Alex Morgan",
    document_type:
      i === 1 || i === 5 ? "Internal Policy" : i === 4 ? "Training" : "SOP",
    file_url: "",
    uploaded_at: dateAgo(4 + i * 3),
    file_size: [
      2457600, 3813376, 1835008, 1228800, 4515840, 983040, 2211840, 716800,
    ][i],
    processing_status: "ready",
    embeddings_count: [156, 248, 124, 86, 312, 64, 142, 48][i],
  }));
  documents.push({
    id: "doc-9",
    document_name: "Front Desk Agent – Job Description.pdf",
    original_filename: "Front Desk Agent – Job Description.pdf",
    department: "Front Office",
    uploaded_by: "demo-admin",
    uploaded_by_name: "Alex Morgan",
    document_type: "Job Description",
    file_url: "",
    uploaded_at: dateAgo(2),
    file_size: 512000,
    processing_status: "ready",
    embeddings_count: 36,
  });
  return {
    users,
    chats,
    documents,
    admins: [
      {
        id: "demo-admin",
        email: "admin@bayview.com",
        display_name: "Alex Morgan",
        role: "admin",
        created_at: dateAgo(120),
      },
    ],
  };
}

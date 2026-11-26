export type Role = "admin" | "head" | "hr" | "it" | "training";
export type Employee = {
  id: string;
  line_user_id: string | null;
  display_name: string;
  profile_image_url: string | null;
  first_seen: string;
  last_seen: string;
  status: "active" | "inactive";
  created_at: string;
  department: string;
  nickname?: string | null;
  position?: string | null;
  access_enabled?: boolean;
  employee_id?: string;
  first_name?: string;
  last_name?: string;
  phone?: string | null;
  is_department_head?: boolean | null;
  can_access_all_documents?: boolean | null;
  email?: string | null;
  auth_user_id?: string | null;
  line_id?: string | null;
  claimed_at?: string | null;
  department_id?: string;
  position_id?: string;
};
export type Chat = {
  id: string;
  user_id: string;
  question: string;
  ai_response: string;
  source_document: string;
  response_status: "success" | "failed" | "fallback" | "replied";
  created_at: string;
  category: string;
  admin_reply?: string | null;
  replied_by?: string | null;
  replied_by_name?: string | null;
  replied_at?: string | null;
  reply_delivery?: "sent" | "failed" | null;
  reply_error?: string | null;
  thread_id?: string | null;
  last_message_at?: string | null;
};
export type Document = {
  id: string;
  document_name: string;
  document_type: string;
  file_url: string;
  processing_status: "ready" | "processing" | "failed";
  uploaded_at: string;
  updated_at?: string | null;
  file_size: number;
  embeddings_count: number;
  original_filename?: string | null;
  file_type?: string | null;
  department?: string | null;
  position?: string | null;
  description?: string | null;
  uploaded_by?: string | null;
  uploaded_by_name?: string | null;
  last_processed_at?: string | null;
  processing_error?: string | null;
  chunks_count?: number | null;
  rag_source_id?: string | null;
  // Where a whole-hotel document is listed on the Documents page.
  list_department?: string | null;
  list_position?: string | null;
};
export type Admin = {
  id: string;
  email: string;
  role: Role;
  // Only set for department heads: the department they may add employees to.
  department?: string | null;
  display_name: string;
  created_at: string;
};
export type Connection = {
  name: string;
  status: "online" | "offline" | "unconfigured";
  detail: string;
};
export type Workspace = {
  users: Employee[];
  chats: Chat[];
  documents: Document[];
  admins: Admin[];
};
export type ReplyAttachment = {
  name: string;
  kind: "image" | "file";
  mime: string;
  size: number;
  url: string;
  preview_url: string | null;
};
export type ChatReply = {
  id: string;
  admin_name: string;
  message: string;
  created_at: string;
  attachments: ReplyAttachment[];
};

export type ThreadMessage = {
  id: string;
  message: string;
  created_at: string;
};

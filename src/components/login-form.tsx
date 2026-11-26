"use client";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { browserClient, isConfigured } from "@/lib/supabase/client";
// Administrators can sign in with a plain username (for example "admin"). Supabase
// needs an email-shaped login, so a username is turned into <username>@USERNAME_DOMAIN.
// Create that account in Supabase Authentication with the same address
// (for example admin@bayview.local). No email is ever sent to it.
const USERNAME_DOMAIN = "bayview.local";
const toLoginEmail = (value: string) => {
  const v = value.trim();
  return v.includes("@") ? v : `${v.toLowerCase()}@${USERNAME_DOMAIN}`;
};

export function LoginForm({ reset = false }: { reset?: boolean }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  // Department heads sign in with an emailed code; administrators with a password.
  const [mode, setMode] = useState<"head" | "admin">(reset ? "admin" : "head");
  // Administrator sign in: the first box takes a username (or an email).
  const usernameLogin = mode === "admin" && !forgot && !reset;
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  useEffect(() => {
    setReady(true);
    const params = new URLSearchParams(window.location.search);
    if (params.get("error"))
      setError(
        "This sign-in link has expired or is invalid. Request a new link.",
      );
  }, []);
  async function sendCode(address: string) {
    const client = browserClient();
    if (!client) return;
    const { error } = await client.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: false },
    });
    // Never reveal whether an email exists: only real throttling is shown.
    if (error && error.status === 429)
      throw new Error(
        "Too many attempts. Please wait a few minutes and try again.",
      );
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    const client = browserClient();
    if (!client) {
      setError("Supabase is not configured. Use the demo workspace below.");
      return;
    }
    setBusy(true);
    try {
      if (reset) {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        await client.auth.signOut();
        setMessage(
          "Password updated. You can now sign in with your new password.",
        );
      } else if (forgot) {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
        });
        if (error) throw error;
        setMessage(
          "If an account exists for this email, you’ll receive a password reset link shortly.",
        );
      } else if (mode === "head") {
        const address = email.trim().toLowerCase();
        if (!codeSent) {
          await sendCode(address);
          setEmail(address);
          setCodeSent(true);
          setMessage(
            "If this email belongs to a department head, we sent a sign-in code to it. Enter the code below.",
          );
        } else {
          const { data, error } = await client.auth.verifyOtp({
            email: address,
            token: code.trim(),
            type: "email",
          });
          if (error || !data.user)
            throw new Error(
              "That code is incorrect or has expired. Request a new one.",
            );
          const { data: head } = await client
            .from("admins")
            .select("id, role")
            .eq("id", data.user.id)
            .single();
          if (!head || head.role !== "head") {
            await client.auth.signOut();
            throw new Error(
              "This email is not registered as a department head. Administrators can use Administrator sign in.",
            );
          }
          router.push("/");
          router.refresh();
        }
      } else {
        const { data, error } = await client.auth.signInWithPassword({
          email: toLoginEmail(email),
          password,
        });
        if (error) throw error;
        const { data: admin, error: accessError } = await client
          .from("admins")
          .select("id, role")
          .eq("id", data.user.id)
          .single();
        if (admin?.role === "head") {
          await client.auth.signOut();
          throw new Error(
            "Department heads sign in with an email code. Go back to department head sign in.",
          );
        }
        if (accessError || !admin) {
          await client.auth.signOut();
          throw new Error(
            "This account does not have administrator access. Contact your workspace administrator.",
          );
        }
        router.push("/");
        router.refresh();
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-story">
        <Image
          className="login-hotel-logo"
          src="/logo_bayview.png"
          alt="The Bayview Pattaya — A Sukosol Hotel"
          width={3508}
          height={2480}
          priority
        />
      </div>
      <div className="login-form-side">
        <div className="login-top-note">
          <ShieldCheck size={15} /> Secure administrator access
        </div>
        <div className="login-card">
          <span className="login-form-icon">
            <Image
              src="/logo_bayview_brown.png"
              alt=""
              width={49}
              height={49}
              aria-hidden="true"
            />
          </span>
          <h2>
            {reset
              ? "Set a new password"
              : forgot
                ? "Forgot your password?"
                : "Welcome to Bayview."}
          </h2>
          <p>
            {reset
              ? "Choose a strong password for your account."
              : forgot
                ? "Enter your work email and we’ll send you a reset link."
                : mode === "head"
                  ? codeSent
                    ? `Enter the code we sent to ${email}.`
                    : "Department heads: enter your work email and we’ll send you a sign-in code."
                  : "Sign in to your Bayview."}
          </p>
          <form onSubmit={submit}>
            <fieldset disabled={!ready} className="login-fields">
              {!reset && !(mode === "head" && codeSent) && (
                <label className="field">
                  {usernameLogin ? "Username or email" : "Email"}
                  <div className="input-with-icon">
                    <Mail size={17} />
                    <input
                      type={usernameLogin ? "text" : "email"}
                      required
                      autoComplete={usernameLogin ? "username" : "email"}
                      autoCapitalize="none"
                      placeholder={usernameLogin ? "admin" : "you@bayview.com"}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </label>
              )}
              {mode === "head" && !reset && !forgot && codeSent && (
                <label className="field">
                  Sign-in code
                  <div className="input-with-icon">
                    <LockKeyhole size={17} />
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      required
                      minLength={6}
                      maxLength={10}
                      autoComplete="one-time-code"
                      placeholder="Enter the code from your email"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </div>
                </label>
              )}
              {mode === "admin" && !forgot && (
                <label className="field">
                  {reset ? "New password" : "Password"}
                  <div className="input-with-icon">
                    <LockKeyhole size={17} />
                    <input
                      type={show ? "text" : "password"}
                      required
                      minLength={reset ? 12 : undefined}
                      autoComplete={reset ? "new-password" : "current-password"}
                      placeholder={
                        reset ? "At least 12 characters" : "Enter your password"
                      }
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      aria-label={show ? "Hide password" : "Show password"}
                      onClick={() => setShow(!show)}
                    >
                      {show ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </label>
              )}
              {!reset && !forgot && (
                <div className="login-options">
                  <span>
                    <ShieldCheck size={13} />
                    Authorized accounts only
                  </span>
                  {mode === "admin" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setForgot(true);
                        setError("");
                        setMessage("");
                      }}
                    >
                      Forgot password?
                    </button>
                  ) : (
                    codeSent && (
                      <button
                        type="button"
                        onClick={async () => {
                          setError("");
                          setMessage("");
                          try {
                            await sendCode(email);
                            setMessage("A new code was sent if the email is registered.");
                          } catch (e) {
                            setError(
                              e instanceof Error
                                ? e.message
                                : "Unable to send a new code.",
                            );
                          }
                        }}
                      >
                        Resend code
                      </button>
                    )
                  )}
                </div>
              )}
              {error && (
                <div className="form-message error" role="alert">
                  {error}
                </div>
              )}
              {message && (
                <div className="form-message success" role="status">
                  {message}
                </div>
              )}
              <button
                className="button primary full login-submit"
                disabled={busy || !isConfigured}
              >
                {busy
                  ? "Please wait…"
                  : reset
                    ? "Update password"
                    : forgot
                      ? "Send reset link"
                      : mode === "head"
                        ? codeSent
                          ? "Verify and sign in"
                          : "Send code"
                        : "Sign in"}
                <ArrowRight size={17} />
              </button>
            </fieldset>
          </form>
          {(forgot || reset) && (
            <button
              className="back-to-login"
              onClick={() => {
                if (reset) router.push("/login");
                else {
                  setForgot(false);
                  setError("");
                  setMessage("");
                }
              }}
            >
              <ArrowLeft size={15} />
              Back to sign in
            </button>
          )}
          {mode === "head" && !reset && !forgot && codeSent && (
            <button
              className="back-to-login"
              type="button"
              onClick={() => {
                setCodeSent(false);
                setCode("");
                setError("");
                setMessage("");
              }}
            >
              <ArrowLeft size={15} />
              Use a different email
            </button>
          )}
          {mode === "admin" && !reset && !forgot && (
            <button
              className="back-to-login"
              type="button"
              onClick={() => {
                setMode("head");
                setPassword("");
                setError("");
                setMessage("");
              }}
            >
              <ArrowLeft size={15} />
              Back to department head sign in
            </button>
          )}
          {mode === "head" && !reset && !forgot && (
            <>
              <div className="login-or">
                <span />
                ADMINISTRATORS
                <span />
              </div>
              <button
                type="button"
                className="button full"
                onClick={() => {
                  setMode("admin");
                  setCodeSent(false);
                  setCode("");
                  setError("");
                  setMessage("");
                }}
              >
                Administrator sign in <ArrowRight size={16} />
              </button>
            </>
          )}
          {!isConfigured && (
            <>
              <div className="login-or">
                <span />
                EXPLORE THE WORKSPACE
                <span />
              </div>
              <Link href="/" className="button full demo-login">
                Enter demo workspace <ArrowRight size={16} />
              </Link>
              <p className="demo-login-note">
                No account needed. Explore with sample data.
              </p>
            </>
          )}
          <div className="login-bottom-note">
            <ShieldCheck size={17} />
            <span>
              Protected access for the people
              <br />
              who keep Bayview running.
            </span>
          </div>
        </div>
        <p className="login-support">
          Need access? Contact your hotel’s IT administrator.
        </p>
      </div>
    </div>
  );
}

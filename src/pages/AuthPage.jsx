import { useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";

const initialForm = {
  nickname: "",
  username: "",
  password: "",
  passwordConfirm: "",
};

export default function AuthPage() {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { authenticate } = useAuth();

  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const data = await api(`/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(form),
      });
      await authenticate(data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-background min-h-screen px-4 py-10">
      <div className="mx-auto grid max-w-5xl items-center gap-10 lg:grid-cols-2">
        <section className="text-center lg:text-left">
          <div className="mb-5 inline-grid size-20 place-items-center rounded-[2rem] bg-primary text-5xl shadow-lg shadow-primary/20">
            👛
          </div>
          <p className="eyebrow">Haengun Pocket · Number games</p>
          <h1 className="text-5xl font-black tracking-tight sm:text-6xl">
            <span className="text-primary">행운</span>주머니
          </h1>
          <p className="mt-4 text-lg font-bold text-base-content/65">
            숫자로 키우는 나만의 행운주머니
          </p>
          <div className="mt-7 inline-flex items-center gap-3 rounded-2xl bg-warning/20 px-5 py-3 text-sm font-bold">
            <span className="text-xl">🌱</span>
            현금 충전·출금·결제 기능이 없는 숫자 게임 서비스예요
          </div>
        </section>

        <section className="rounded-[2rem] bg-base-100 p-5 shadow-2xl shadow-primary/10 sm:p-8">
          <div role="tablist" className="tabs tabs-box mb-6 grid grid-cols-2 rounded-2xl bg-base-200 p-1">
            {[
              ["login", "로그인"],
              ["register", "회원가입"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                className={`tab h-11 rounded-xl font-black ${mode === key ? "tab-active bg-base-100 shadow-sm" : ""}`}
                onClick={() => {
                  setMode(key);
                  setError("");
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="space-y-4">
            {mode === "register" && (
              <label className="form-control block">
                <span className="label-text mb-2 block font-bold">닉네임</span>
                <input
                  className="input input-bordered w-full rounded-2xl"
                  name="nickname"
                  minLength="2"
                  maxLength="12"
                  value={form.nickname}
                  onChange={update}
                  placeholder="행운주머니"
                  required
                />
              </label>
            )}
            <label className="form-control block">
              <span className="label-text mb-2 block font-bold">아이디</span>
              <input
                className="input input-bordered w-full rounded-2xl"
                name="username"
                autoComplete="username"
                minLength="4"
                maxLength="20"
                value={form.username}
                onChange={update}
                placeholder="영문, 숫자, 밑줄 4~20자"
                required
              />
            </label>
            <label className="form-control block">
              <span className="label-text mb-2 block font-bold">비밀번호</span>
              <input
                className="input input-bordered w-full rounded-2xl"
                name="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength="6"
                maxLength="72"
                value={form.password}
                onChange={update}
                placeholder="6자 이상"
                required
              />
            </label>
            {mode === "register" && (
              <label className="form-control block">
                <span className="label-text mb-2 block font-bold">비밀번호 확인</span>
                <input
                  className="input input-bordered w-full rounded-2xl"
                  name="passwordConfirm"
                  type="password"
                  autoComplete="new-password"
                  value={form.passwordConfirm}
                  onChange={update}
                  required
                />
              </label>
            )}
            {error && <div className="alert alert-error rounded-2xl text-sm">{error}</div>}
            <button className="btn btn-primary h-13 w-full rounded-2xl text-base" disabled={submitting}>
              {submitting && <span className="loading loading-spinner loading-sm" />}
              {mode === "login" ? "내 행운주머니 열기" : "1,000,000원 받고 시작하기"}
            </button>
          </form>
          <p className="mt-5 text-center text-xs leading-relaxed text-base-content/45">
            가입 시 사이트 내부 자산 1,000,000원이 지급됩니다.<br />
            실제 금전 가치가 없으며 현금으로 바꿀 수 없습니다.
          </p>
        </section>
      </div>
    </main>
  );
}

import { Component } from "react";
import { setToken } from "../api/client";
import { BaseCard } from "./ui";

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error("Application render failed", error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="grid min-h-screen place-items-center bg-base-200 px-4">
        <BaseCard className="w-full max-w-md text-center">
          <div className="text-5xl">🧯</div>
          <h1 className="mt-4 text-2xl font-black">화면을 불러오지 못했어요</h1>
          <p className="mt-2 text-sm text-base-content/60">
            저장된 로그인 상태를 유지한 채 다시 불러오거나 로그인 화면으로 돌아갈 수 있어요.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              className="btn btn-primary rounded-2xl"
              onClick={() => window.location.reload()}
            >
              다시 불러오기
            </button>
            <button
              type="button"
              className="btn btn-ghost rounded-2xl"
              onClick={() => {
                setToken(null);
                window.location.replace("/");
              }}
            >
              로그인 화면
            </button>
          </div>
        </BaseCard>
      </main>
    );
  }
}

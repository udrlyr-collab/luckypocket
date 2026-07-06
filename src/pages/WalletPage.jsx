import { useMemo, useState } from "react";
import { api } from "../api/client";
import AnimatedMoney from "../components/AnimatedMoney";
import ResultModal from "../components/ResultModal";
import { useAuth } from "../context/AuthContext";
import { formatMoney } from "../utils/format";

const ADD_AMOUNTS = [10000, 100000, 1000000];
const RATIOS = [0.01, 0.05, 0.1];

function digitsOnly(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

export default function WalletPage() {
  const { user, refreshUser } = useAuth();
  const [receiverNickname, setReceiverNickname] = useState("");
  const [amount, setAmount] = useState("0");
  const [confirming, setConfirming] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState("");
  const [transferSuccess, setTransferSuccess] = useState("");
  const [code, setCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState("");
  const [bonusResult, setBonusResult] = useState(null);
  const numberAmount = digitsOnly(amount);
  const maximum = user.balance;
  const formattedAmount = numberAmount ? numberAmount.toLocaleString("ko-KR") : "";

  const amountError = useMemo(() => {
    if (numberAmount > 0 && numberAmount < 1000) return "최소 송금액은 1,000원이에요.";
    if (numberAmount > maximum) return `최대 ${formatMoney(maximum)}까지 보낼 수 있어요.`;
    return "";
  }, [maximum, numberAmount]);

  const changeAmount = (next) => {
    setAmount(String(Math.min(user.balance, Math.max(0, Math.floor(next)))));
  };

  const openConfirmation = () => {
    setTransferError("");
    if (!receiverNickname.trim()) {
      setTransferError("받는 사람의 닉네임을 입력해 주세요.");
      return;
    }
    if (numberAmount < 1000 || numberAmount > maximum) {
      setTransferError("송금할 금액을 확인해주세요.");
      return;
    }
    setConfirming(true);
  };

  const transfer = async () => {
    setTransferBusy(true);
    setTransferError("");
    try {
      const data = await api("/transfer", {
        method: "POST",
        body: JSON.stringify({
          receiverNickname: receiverNickname.trim(),
          amount: numberAmount,
        }),
      });
      setConfirming(false);
      setTransferSuccess(data.message);
      setReceiverNickname("");
      setAmount("0");
      await refreshUser();
      window.setTimeout(() => setTransferSuccess(""), 3500);
    } catch (error) {
      setConfirming(false);
      setTransferError(error.message);
    } finally {
      setTransferBusy(false);
    }
  };

  const redeemCode = async () => {
    setCodeBusy(true);
    setCodeError("");
    try {
      const data = await api("/bonus-code/redeem", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setBonusResult({
        won: true,
        payout: data.rewardAmount,
        profit: data.rewardAmount,
        achievements: data.achievements,
      });
      setCode("");
      await refreshUser();
    } catch (error) {
      setCodeError(error.message);
    } finally {
      setCodeBusy(false);
    }
  };

  return (
    <div className="page-content">
      <p className="eyebrow">Share the luck</p>
      <h1 className="text-3xl font-black">행운 나누기</h1>
      <p className="mt-2 text-sm text-base-content/55">
        다른 주머니에 행운을 보내거나, 운영자가 발급한 행운코드를 사용할 수 있어요.
      </p>

      <div className="my-6 rounded-2xl bg-primary/12 p-4 text-center">
        <span className="text-xs font-bold text-base-content/50">현재 자산</span>
        <strong className="ml-3 text-2xl tabular-nums">
          <AnimatedMoney value={user.balance} className="text-primary" />
        </strong>
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <section className={`soft-card min-w-0 ${transferSuccess ? "coin-fly-success glow-success" : ""}`}>
          <div className="mb-5 flex items-center gap-3">
            <span className="grid size-12 place-items-center rounded-2xl bg-success/15 text-2xl">💸</span>
            <div>
              <h2 className="text-xl font-black">송금하기</h2>
              <p className="text-xs text-base-content/50">보유 자산 안에서 송금할 수 있어요. 회사 인수자는 송금을 받을 수 없어요.</p>
            </div>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-bold">받는 사람 닉네임</span>
            <input
              className="input input-bordered w-full rounded-2xl"
              value={receiverNickname}
              maxLength="12"
              onChange={(event) => setReceiverNickname(event.target.value)}
              placeholder="닉네임을 정확히 입력하세요"
            />
          </label>

          <label className="mt-4 block">
            <span className="mb-2 flex justify-between text-sm font-bold">
              <span>송금할 금액</span>
              <span className="text-xs text-base-content/45">최대 {formatMoney(maximum)}</span>
            </span>
            <div className="join flex">
              <input
                className="input input-bordered join-item min-w-0 flex-1 text-right text-lg font-black tabular-nums"
                type="text"
                inputMode="numeric"
                value={formattedAmount}
                onChange={(event) => changeAmount(digitsOnly(event.target.value))}
                placeholder="0"
              />
              <span className="join-item flex items-center border border-base-300 bg-base-200 px-4 font-bold">원</span>
            </div>
          </label>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {ADD_AMOUNTS.map((addition) => (
              <button
                type="button"
                className="btn btn-sm rounded-xl bg-base-200"
                key={addition}
                onClick={() => changeAmount(Math.min(maximum, numberAmount + addition))}
              >
                +{addition.toLocaleString("ko-KR")}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {RATIOS.map((ratio) => (
              <button
                type="button"
                className="btn btn-sm rounded-xl bg-base-200"
                key={ratio}
                onClick={() => changeAmount(Math.floor(user.balance * ratio))}
              >
                {ratio * 100}%
              </button>
            ))}
          </div>
          <p className="mt-2 min-h-5 text-xs font-bold text-error">{amountError || transferError}</p>
          <button
            type="button"
            className="btn btn-success mt-2 h-13 w-full rounded-2xl"
            disabled={transferBusy}
            onClick={openConfirmation}
          >
            송금 확인
          </button>
          {transferSuccess && (
            <div className="wallet-toast achievement-pop mt-3 rounded-2xl bg-success/20 p-3 text-center font-black text-success">
              {transferSuccess}
            </div>
          )}
        </section>

        <section className={`soft-card min-w-0 ${bonusResult ? "pouch-open glow-warning" : ""}`}>
          <div className="mb-5 flex items-center gap-3">
            <span className="grid size-12 place-items-center rounded-2xl bg-warning/20 text-2xl">🎁</span>
            <div>
              <h2 className="text-xl font-black">행운코드</h2>
              <p className="text-xs text-base-content/50">운영자가 발급한 활성 코드만 사용할 수 있어요.</p>
            </div>
          </div>
          <p className="mb-4 text-sm text-base-content/60">
            행운코드를 입력하면 보너스를 받을 수 있어요.
          </p>
          <input
            className="input input-bordered w-full rounded-2xl font-black uppercase tracking-wider"
            value={code}
            maxLength="40"
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="행운코드 입력"
            autoComplete="off"
          />
          {codeError && <p className="mt-2 text-xs font-bold text-error">{codeError}</p>}
          <button
            type="button"
            className="btn btn-warning mt-4 h-13 w-full rounded-2xl"
            disabled={codeBusy || !code.trim()}
            onClick={redeemCode}
          >
            {codeBusy ? <span className="loading loading-spinner loading-sm" /> : "행운코드 사용"}
          </button>
          <div className="mt-5 rounded-2xl bg-base-200/65 p-4 text-xs leading-relaxed text-base-content/55">
            코드는 사용 횟수와 만료일이 정해질 수 있으며, 같은 계정에서 반복 사용할 수 없어요.
          </div>
        </section>
      </div>

      {confirming && (
        <div className="modal modal-open" role="dialog" aria-modal="true">
          <div className="modal-box rounded-[2rem] text-center">
            <div className="mb-3 text-5xl">💌</div>
            <h2 className="text-xl font-black">송금 전 확인</h2>
            <p className="my-5 text-base">
              정말 <strong>{receiverNickname.trim()}님</strong>에게{" "}
              <strong className="text-primary">{formatMoney(numberAmount)}</strong>을 보낼까요?
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button className="btn rounded-2xl" onClick={() => setConfirming(false)}>취소</button>
              <button className="btn btn-success rounded-2xl" disabled={transferBusy} onClick={transfer}>
                {transferBusy ? <span className="loading loading-spinner loading-sm" /> : "보내기"}
              </button>
            </div>
          </div>
          <button className="modal-backdrop" type="button" aria-label="송금 확인 닫기" onClick={() => setConfirming(false)} />
        </div>
      )}

      <ResultModal
        result={bonusResult}
        onClose={() => setBonusResult(null)}
        successMessage="행운코드 성공!"
        showCoins
      >
        <p className="mt-3 text-sm">행운주머니가 열리고 보너스가 도착했어요.</p>
      </ResultModal>
    </div>
  );
}

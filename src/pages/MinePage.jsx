import { useEffect, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import AnimatedMoney from "../components/AnimatedMoney";

export default function MinePage() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mining, setMining] = useState(false);
  const [floatingTexts, setFloatingTexts] = useState([]);
  const textIdRef = useRef(0);
  const rockRef = useRef(null);
  const lastClickTimeRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    api("/mine/status")
      .then(data => {
        if (!mounted) return;
        if (!data.canEnterMine) {
          navigate("/home", { replace: true });
          return;
        }
        setStatus(data);
      })
      .catch(() => {
        if (mounted) navigate("/home");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [navigate]);

  const addFloatingText = (text, type, x, y) => {
    const id = textIdRef.current++;
    setFloatingTexts(prev => [...prev, { id, text, type, x, y }]);
    setTimeout(() => {
      setFloatingTexts(prev => prev.filter(t => t.id !== id));
    }, 1000);
  };

  const handleMine = async (e) => {
    if (mining || !status || !status.canMine) return;

    const now = Date.now();
    if (now - lastClickTimeRef.current < 150) return; // Prevent absolute spam
    lastClickTimeRef.current = now;

    const rect = rockRef.current.getBoundingClientRect();
    // randomize click position slightly around the center
    const clickX = e.clientX || rect.left + rect.width / 2;
    const clickY = e.clientY || rect.top + rect.height / 2;

    setMining(true);
    rockRef.current.classList.remove("animate-rock-hit");
    void rockRef.current.offsetWidth; // trigger reflow
    rockRef.current.classList.add("animate-rock-hit");

    try {
      const res = await api("/mine/click", { method: "POST" });
      setStatus(prev => ({
        ...prev,
        balance: res.balanceAfter,
        canMine: res.canMine,
        totalMineClicks: prev.totalMineClicks + 1,
        totalMineEarned: prev.totalMineEarned + res.actualReward,
        recentFinds: [{
          resultType: res.resultType,
          label: res.label,
          reward: res.actualReward,
          createdAt: new Date().toISOString()
        }, ...prev.recentFinds].slice(0, 10)
      }));
      
      refreshUser();

      if (res.actualReward > 0) {
        addFloatingText(`+${res.actualReward}`, res.resultType, clickX, clickY);
      } else {
        addFloatingText("가득 찼어요!", "system", clickX, clickY);
      }
    } catch (err) {
      addFloatingText("앗!", "error", clickX, clickY);
    } finally {
      setTimeout(() => setMining(false), 80);
    }
  };

  if (loading) return <div className="page-content py-20 flex justify-center"><span className="loading loading-spinner text-primary" /></div>;
  if (!status) return null;

  return (
    <div className="page-content pb-16">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="eyebrow">COAL MINE</p>
          <h1 className="text-3xl font-black">탄광</h1>
          <p className="mt-2 text-sm text-base-content/60">
            주머니가 가벼워졌네요. 자원을 캐서 1,000,000원까지 채워보세요.
          </p>
        </div>
        <Link to="/home" className="btn btn-sm btn-ghost">나가기</Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* Mining Area */}
        <div className="soft-card flex flex-col items-center justify-center p-8 min-h-[400px] relative overflow-hidden bg-gradient-to-b from-base-200 to-base-300">
          <div className="mb-8 w-full max-w-md bg-base-100 rounded-2xl p-4 shadow-sm text-center">
            <span className="text-xs font-black text-base-content/50 block mb-1">현재 자산 / 목표 자산</span>
            <div className="flex items-center justify-center gap-2">
              <strong className="text-2xl font-black text-primary"><AnimatedMoney value={status.balance} /></strong>
              <span className="text-base-content/40">/</span>
              <span className="text-lg font-bold text-base-content/60">{status.targetBalance.toLocaleString()}</span>
            </div>
            <progress 
              className="progress progress-primary w-full mt-3 h-3" 
              value={status.balance} 
              max={status.targetBalance}
            ></progress>
          </div>

          <button 
            className="relative select-none outline-none group"
            onClick={handleMine}
            disabled={!status.canMine}
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <div 
              ref={rockRef}
              className={`text-9xl transition-transform duration-75 ${status.canMine ? 'cursor-pointer hover:scale-105 active:scale-95' : 'opacity-50 grayscale'}`}
            >
              🪨
            </div>
            
            {status.canMine && (
              <div className={`absolute top-0 right-0 text-7xl origin-bottom-right transition-transform duration-100 ${mining ? 'rotate-[-60deg]' : 'rotate-12 group-hover:rotate-0'}`}>
                ⛏️
              </div>
            )}
          </button>

          {!status.canMine && (
            <div className="absolute inset-0 bg-base-100/80 backdrop-blur-sm flex items-center justify-center flex-col z-20">
              <span className="text-6xl mb-4">🎉</span>
              <h2 className="text-2xl font-black mb-2">목표 달성!</h2>
              <p className="text-base-content/70 mb-6">충분한 자본이 모였어요. 다시 게임을 하러 가볼까요?</p>
              <Link to="/home" className="btn btn-primary rounded-2xl h-12 px-8">홈으로 가기</Link>
            </div>
          )}

          {/* Floating Texts */}
          {floatingTexts.map(t => (
            <div 
              key={t.id} 
              className={`fixed pointer-events-none z-50 text-xl font-black animate-float-up ${t.type === 'diamond' ? 'text-info' : t.type === 'gold' ? 'text-warning' : t.type === 'error' ? 'text-error' : 'text-primary'}`}
              style={{ left: t.x - 20, top: t.y - 20 }}
            >
              {t.text}
            </div>
          ))}
        </div>

        {/* Stats & History */}
        <div className="flex flex-col gap-4">
          <div className="soft-card p-5">
            <h3 className="font-black text-sm mb-4">나의 채굴 현황</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-base-200 rounded-xl p-3">
                <span className="block text-[10px] font-bold text-base-content/50">총 캔 자원</span>
                <strong className="text-sm font-black tabular-nums">{status.totalMineEarned.toLocaleString()}원</strong>
              </div>
              <div className="bg-base-200 rounded-xl p-3">
                <span className="block text-[10px] font-bold text-base-content/50">곡괭이질 횟수</span>
                <strong className="text-sm font-black tabular-nums">{status.totalMineClicks.toLocaleString()}회</strong>
              </div>
            </div>
          </div>

          <div className="soft-card p-5 flex-1 overflow-hidden flex flex-col">
            <h3 className="font-black text-sm mb-4">최근 발견한 광물</h3>
            <div className="flex-1 overflow-y-auto pr-2 space-y-2">
              {status.recentFinds.map((find, i) => (
                <div key={i} className="flex justify-between items-center text-xs py-1">
                  <span className="flex items-center gap-1.5">
                    {find.resultType === 'diamond' ? '💎' : find.resultType === 'gold' ? '🟡' : find.resultType === 'iron' ? '⚪' : find.resultType === 'coal' ? '⚫' : '🪨'}
                    <span className="font-bold opacity-80">{find.label}</span>
                  </span>
                  <span className="font-black tabular-nums text-primary">+{find.reward.toLocaleString()}</span>
                </div>
              ))}
              {status.recentFinds.length === 0 && (
                <div className="text-center py-6 text-xs text-base-content/40">아직 발견한 광물이 없어요.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

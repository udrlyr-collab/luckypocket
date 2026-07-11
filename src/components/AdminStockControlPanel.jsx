import { useEffect, useState } from "react";
import { api } from "../api/client";
import { formatMoney } from "../utils/format";
import { SectionHeader, BaseCard } from "./ui";

const COMPANY_SECTORS = ["AI", "보안", "게임", "식품", "에너지", "광업", "바이오", "미디어", "운송", "금융", "소비재", "소프트웨어", "제조", "기타"];

/**
 * AdminStockControlPanel — 관리자 주가 조정 공통 패널 컴포넌트
 *
 * Props:
 *   stock        — 현재 종목 객체
 *   onActionComplete — 액션 성공 후 콜백 (refetch 등)
 *   compact      — true이면 종목 선택 숨김, 종목명/현재가만 표시 (StockDetailPage용)
 */
export default function AdminStockControlPanel({ stock, onActionComplete, compact = false, canEditCompanyProfile = false }) {
  const [openSection, setOpenSection] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // --- Manual Adjust State ---
  const [adjust, setAdjust] = useState({
    mode: "percent",
    direction: "up",
    value: "",
    targetPrice: "",
    reason: "",
    newsTitle: "",
    newsContent: "",
    publishNews: true,
  });

  // --- Target Price State ---
  const [target, setTarget] = useState({
    targetPrice: "",
    percentPerTick: "",
    reason: "",
    newsTitle: "",
    newsContent: "",
    publishNews: true,
  });

  // --- Blue Chip State ---
  const [blueChip, setBlueChip] = useState({
    targetPrice: "",
    rampPercent: "30",
    reason: "우량주 편입 이벤트",
    newsTitle: "",
    newsContent: "",
    publishNews: true,
  });
  const [companyProfile, setCompanyProfile] = useState({
    name: stock.name || "",
    sector: stock.sector || "기타",
    reason: "관리자 회사 정보 변경",
  });

  useEffect(() => {
    setCompanyProfile({
      name: stock.name || "",
      sector: stock.sector || "기타",
      reason: "관리자 회사 정보 변경",
    });
  }, [stock.id, stock.name, stock.sector]);

  const currentPrice = stock.current_price || stock.currentPrice || 0;

  const toggle = (section) => setOpenSection((prev) => (prev === section ? null : section));

  const doAction = async (fn) => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await fn();
      if (onActionComplete) await onActionComplete();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // --- Manual Adjust ---
  const applyAdjust = () =>
    doAction(async () => {
      const isSetPrice = adjust.mode === "set_price";
      const res = await api(`/admin/stocks/${stock.id}/manual-adjust`, {
        method: "POST",
        body: JSON.stringify({
          mode: adjust.mode,
          direction: isSetPrice ? undefined : adjust.direction,
          value: isSetPrice ? undefined : Number(adjust.value),
          targetPrice: isSetPrice ? Number(adjust.targetPrice) : undefined,
          reason: adjust.reason,
          newsTitle: adjust.newsTitle,
          newsContent: adjust.newsContent,
          publishNews: adjust.publishNews,
        }),
      });
      setMessage(res.message);
      setAdjust((c) => ({ ...c, value: "", targetPrice: "", reason: "", newsTitle: "", newsContent: "", publishNews: true }));
    });

  // --- Target Price Event ---
  const applyTarget = () =>
    doAction(async () => {
      const res = await api(`/admin/stocks/${stock.id}/target-price`, {
        method: "POST",
        body: JSON.stringify({
          targetPrice: Number(target.targetPrice),
          percentPerTick: Number(target.percentPerTick),
          reason: target.reason,
          newsTitle: target.newsTitle,
          newsContent: target.newsContent,
          publishNews: target.publishNews,
        }),
      });
      setMessage(res.message);
      setTarget((c) => ({ ...c, targetPrice: "", percentPerTick: "", reason: "", newsTitle: "", newsContent: "", publishNews: true }));
    });

  // --- Blue Chip ---
  const applyBlueChip = () =>
    doAction(async () => {
      const res = await api(`/admin/stocks/${stock.id}/blue-chip`, {
        method: "POST",
        body: JSON.stringify({
          targetPrice: Number(blueChip.targetPrice),
          rampPercentPerTick: Number(blueChip.rampPercent),
          reason: blueChip.reason,
          newsTitle: blueChip.newsTitle,
          newsContent: blueChip.newsContent,
          publishNews: blueChip.publishNews,
        }),
      });
      setMessage(res.message);
      setBlueChip((c) => ({ ...c, targetPrice: "", rampPercent: "30", reason: "우량주 편입 이벤트", newsTitle: "", newsContent: "", publishNews: true }));
    });

  const revokeBlueChip = () =>
    doAction(async () => {
      if (!window.confirm("정말 우량주를 해제하시겠습니까?")) throw new Error("취소됨");
      const res = await api(`/admin/stocks/${stock.id}/blue-chip`, { method: "DELETE" });
      setMessage(res.message);
    });

  const applyCompanyProfile = () =>
    doAction(async () => {
      const res = await api(`/admin/stocks/${stock.id}/profile`, {
        method: "PATCH",
        body: JSON.stringify(companyProfile),
      });
      setMessage(res.message);
    });

  const isTargetUp = target.targetPrice ? Number(target.targetPrice) > currentPrice : null;

  const blueChipRampActive = stock.blueChipRampActive || (stock.blue_chip_target_price && stock.blue_chip_ramp_percent_per_tick && stock.is_bluechip === 1 && currentPrice < (stock.blue_chip_target_price || stock.blueChipTargetPrice || 0));
  const adminTargetActive = stock.adminPriceTargetActive || stock.admin_price_target_active;

  return (
    <section className="rounded-3xl border border-info/30 bg-info/5 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-black tracking-widest text-info uppercase">ADMIN CONTROL</p>
          <h3 className="text-lg sm:text-xl font-black text-base-content">관리자 주가 관리</h3>
        </div>
        {compact && (
          <div className="text-right">
            <p className="text-xs font-bold text-base-content/50">현재 종목</p>
            <p className="font-black text-base-content text-sm">{stock.name}</p>
            <p className="text-sm font-black text-primary tabular-nums">{formatMoney(currentPrice)}</p>
          </div>
        )}
      </div>

      {/* Status Messages */}
      {message && <div className="alert alert-success rounded-2xl text-sm font-bold mb-4">{message}</div>}
      {error && <div className="alert alert-error rounded-2xl text-sm font-bold mb-4">{error}</div>}

      {/* Active Events Display */}
      {(blueChipRampActive || adminTargetActive) && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          {blueChipRampActive && (
            <div className="rounded-2xl bg-warning/10 border border-warning/30 p-4">
              <p className="text-xs font-black text-warning uppercase tracking-wider mb-2">우량주 목표주가 진행 중</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-base-content/50 text-xs">현재가</span><br /><strong className="font-black tabular-nums">{formatMoney(currentPrice)}</strong></div>
                <div><span className="text-base-content/50 text-xs">목표주가</span><br /><strong className="font-black tabular-nums">{formatMoney(stock.blueChipTargetPrice || stock.blue_chip_target_price)}</strong></div>
                <div><span className="text-base-content/50 text-xs">tick당 상승률</span><br /><strong className="font-black text-success">+{stock.blueChipRampPercentPerTick || stock.blue_chip_ramp_percent_per_tick}%</strong></div>
                <div>
                  <span className="text-base-content/50 text-xs">도달률</span><br />
                  <strong className="font-black tabular-nums text-info">
                    {Math.min(100, Math.floor((currentPrice / (stock.blueChipTargetPrice || stock.blue_chip_target_price || 1)) * 100))}%
                  </strong>
                </div>
              </div>
            </div>
          )}
          {adminTargetActive && (
            <div className="rounded-2xl bg-info/10 border border-info/30 p-4">
              <p className="text-xs font-black text-info uppercase tracking-wider mb-2">목표주가 이벤트 진행 중</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-base-content/50 text-xs">현재가</span><br /><strong className="font-black tabular-nums">{formatMoney(currentPrice)}</strong></div>
                <div><span className="text-base-content/50 text-xs">목표주가</span><br /><strong className="font-black tabular-nums">{formatMoney(stock.adminPriceTarget || stock.admin_price_target)}</strong></div>
                <div>
                  <span className="text-base-content/50 text-xs">tick당 변동률</span><br />
                  <strong className={`font-black ${(stock.adminPriceTargetDirection || stock.admin_price_target_direction) === "up" ? "text-success" : "text-error"}`}>
                    {(stock.adminPriceTargetDirection || stock.admin_price_target_direction) === "up" ? "+" : "-"}{stock.adminPriceTargetPercentPerTick || stock.admin_price_target_percent_per_tick}%
                  </strong>
                </div>
                <div>
                  <span className="text-base-content/50 text-xs">도달률</span><br />
                  <strong className="font-black tabular-nums text-info">
                    {Math.min(100, Math.floor((currentPrice / (stock.adminPriceTarget || stock.admin_price_target || 1)) * 100))}%
                  </strong>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 1. Manual Adjust Accordion */}
      {canEditCompanyProfile && <AccordionCard
        title="회사 정보 강제 변경"
        eyebrow="ADMIN COMPANY PROFILE"
        badge={stock.sector || "기타"}
        isOpen={openSection === "profile"}
        onToggle={() => toggle("profile")}
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <label className="form-control">
            <span className="label-text mb-1 font-bold">현재 회사명</span>
            <input className="input input-bordered h-12 w-full rounded-2xl" value={stock.name || ""} disabled />
          </label>
          <label className="form-control">
            <span className="label-text mb-1 font-bold">새 회사명</span>
            <input
              className="input input-bordered h-12 w-full rounded-2xl"
              value={companyProfile.name}
              onChange={(event) => setCompanyProfile((current) => ({ ...current, name: event.target.value }))}
              maxLength={30}
            />
          </label>
          <label className="form-control">
            <span className="label-text mb-1 font-bold">현재 섹터</span>
            <input className="input input-bordered h-12 w-full rounded-2xl" value={stock.sector || "기타"} disabled />
          </label>
          <label className="form-control">
            <span className="label-text mb-1 font-bold">새 섹터</span>
            <select
              className="select select-bordered h-12 w-full rounded-2xl"
              value={COMPANY_SECTORS.includes(companyProfile.sector) ? companyProfile.sector : "__custom"}
              onChange={(event) => setCompanyProfile((current) => ({
                ...current,
                sector: event.target.value === "__custom" ? "" : event.target.value,
              }))}
            >
              {COMPANY_SECTORS.map((sector) => <option key={sector} value={sector}>{sector}</option>)}
              <option value="__custom">직접 입력</option>
            </select>
          </label>
          {!COMPANY_SECTORS.includes(companyProfile.sector) && (
            <label className="form-control lg:col-span-2">
              <span className="label-text mb-1 font-bold">직접 입력 섹터</span>
              <input
                className="input input-bordered h-12 w-full rounded-2xl"
                value={companyProfile.sector}
                onChange={(event) => setCompanyProfile((current) => ({ ...current, sector: event.target.value }))}
                maxLength={20}
              />
            </label>
          )}
          <label className="form-control lg:col-span-2">
            <span className="label-text mb-1 font-bold">변경 사유</span>
            <input
              className="input input-bordered h-12 w-full rounded-2xl"
              value={companyProfile.reason}
              onChange={(event) => setCompanyProfile((current) => ({ ...current, reason: event.target.value }))}
              maxLength={120}
            />
          </label>
        </div>
        <button
          type="button"
          className="btn btn-primary mt-4 min-h-12 w-full rounded-2xl"
          disabled={busy || companyProfile.name.trim().length < 2 || !companyProfile.sector.trim()}
          onClick={applyCompanyProfile}
        >
          {busy ? <span className="loading loading-spinner loading-sm" /> : "회사 정보 변경"}
        </button>
      </AccordionCard>}

      <AccordionCard
        title="주가 즉시 조정"
        eyebrow="ADMIN STOCK CONTROL"
        badge={`현재가 ${formatMoney(currentPrice)}`}
        isOpen={openSection === "adjust"}
        onToggle={() => toggle("adjust")}
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <label className="form-control">
            <span className="label-text mb-1 block font-bold">조정 방식</span>
            <select
              className="select select-bordered w-full h-12 rounded-2xl"
              value={adjust.mode}
              onChange={(e) => setAdjust((c) => ({ ...c, mode: e.target.value }))}
            >
              <option value="percent">퍼센트(%)</option>
              <option value="amount">금액(원)</option>
              <option value="set_price">직접 가격설정(원)</option>
            </select>
          </label>
          {adjust.mode !== "set_price" && (
            <label className="form-control">
              <span className="label-text mb-1 font-bold">조정 방향</span>
              <select
                className="select select-bordered h-12 rounded-2xl"
                value={adjust.direction}
                onChange={(e) => setAdjust((c) => ({ ...c, direction: e.target.value }))}
              >
                <option value="up">상승</option>
                <option value="down">하락</option>
              </select>
            </label>
          )}
          <label className="form-control min-w-0">
            <span className="label-text mb-1 block font-bold">사유</span>
            <input
              className="input input-bordered w-full h-12 min-w-0 rounded-2xl"
              value={adjust.reason}
              onChange={(e) => setAdjust((c) => ({ ...c, reason: e.target.value }))}
              placeholder="사유 입력 (선택)"
              maxLength={120}
            />
          </label>
          <label className="form-control min-w-0">
            <span className="label-text mb-1 block font-bold">공지 제목 (선택)</span>
            <input
              className="input input-bordered w-full h-12 min-w-0 rounded-2xl"
              value={adjust.newsTitle}
              onChange={(e) => setAdjust((c) => ({ ...c, newsTitle: e.target.value }))}
              placeholder="예: 신규 사업 기대감"
              maxLength={100}
            />
          </label>
          <label className="form-control min-w-0 lg:col-span-2">
            <span className="label-text mb-1 block font-bold">공지 내용 (선택)</span>
            <textarea
              className="textarea textarea-bordered w-full min-w-0 rounded-2xl py-2 min-h-[48px]"
              value={adjust.newsContent}
              onChange={(e) => setAdjust((c) => ({ ...c, newsContent: e.target.value }))}
              placeholder={adjust.direction === "up" || adjust.mode === "set_price"
                ? "예: 신규 사업 기대감으로 주가가 상승했어요."
                : "예: 실적 부진 우려로 주가가 하락했어요."}
            />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="checkbox"
            className="checkbox checkbox-primary rounded-lg"
            checked={adjust.publishNews}
            onChange={(e) => setAdjust((c) => ({ ...c, publishNews: e.target.checked }))}
            id={`adj-publish-${stock.id}`}
          />
          <label htmlFor={`adj-publish-${stock.id}`} className="text-xs font-bold text-base-content/70 cursor-pointer">
            시장 공지 발행 및 행운소식 등록
          </label>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
          {adjust.mode === "set_price" ? (
            <input
              className="input input-bordered h-12 min-w-0 rounded-2xl text-right tabular-nums"
              type="number" min="1"
              value={adjust.targetPrice}
              onChange={(e) => setAdjust((c) => ({ ...c, targetPrice: e.target.value }))}
              placeholder="예: 5000"
            />
          ) : (
            <input
              className="input input-bordered h-12 min-w-0 rounded-2xl text-right tabular-nums"
              type="number" min="0"
              step={adjust.mode === "percent" ? "0.1" : "1"}
              value={adjust.value}
              onChange={(e) => setAdjust((c) => ({ ...c, value: e.target.value }))}
              placeholder={adjust.mode === "percent" ? "예: 5" : "예: 500"}
            />
          )}
          <button
            type="button"
            className="btn btn-primary h-12 whitespace-nowrap rounded-2xl"
            disabled={busy || (adjust.mode !== "set_price" && adjust.value === "") || (adjust.mode === "set_price" && adjust.targetPrice === "")}
            onClick={applyAdjust}
          >
            {busy ? <span className="loading loading-spinner loading-sm" /> : "즉시 적용"}
          </button>
        </div>
      </AccordionCard>

      {/* 2. Target Price Event Accordion */}
      <AccordionCard
        title="목표주가 이벤트"
        eyebrow="ADMIN TARGET PRICE"
        badge={`현재가 ${formatMoney(currentPrice)}`}
        isOpen={openSection === "target"}
        onToggle={() => toggle("target")}
        className="mt-3"
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <label className="form-control">
            <span className="label-text mb-1 block font-bold">목표주가</span>
            <input
              className="input input-bordered w-full h-12 min-w-0 rounded-2xl"
              type="number" min="1"
              value={target.targetPrice}
              onChange={(e) => setTarget((c) => ({ ...c, targetPrice: e.target.value }))}
              placeholder="예: 30000"
            />
          </label>
          <label className="form-control">
            <span className="label-text mb-1 block font-bold">tick당 변동률 (%)</span>
            <input
              className="input input-bordered w-full h-12 min-w-0 rounded-2xl"
              type="number" min="1" max="100"
              value={target.percentPerTick}
              onChange={(e) => setTarget((c) => ({ ...c, percentPerTick: e.target.value }))}
              placeholder="예: 20"
            />
          </label>
          <label className="form-control min-w-0">
            <span className="label-text mb-1 block font-bold">사유</span>
            <input
              className="input input-bordered w-full h-12 min-w-0 rounded-2xl"
              value={target.reason}
              onChange={(e) => setTarget((c) => ({ ...c, reason: e.target.value }))}
              placeholder="사유 입력 (선택)"
              maxLength={120}
            />
          </label>
          <label className="form-control min-w-0">
            <span className="label-text mb-1 block font-bold">공지 제목 (선택)</span>
            <input
              className="input input-bordered w-full h-12 min-w-0 rounded-2xl"
              value={target.newsTitle}
              onChange={(e) => setTarget((c) => ({ ...c, newsTitle: e.target.value }))}
              placeholder="예: 신규 사업 기대감"
              maxLength={100}
            />
          </label>
          <label className="form-control min-w-0 lg:col-span-2">
            <span className="label-text mb-1 block font-bold">공지 내용 (선택)</span>
            <textarea
              className="textarea textarea-bordered w-full min-w-0 rounded-2xl py-2 min-h-[48px]"
              value={target.newsContent}
              onChange={(e) => setTarget((c) => ({ ...c, newsContent: e.target.value }))}
              placeholder={isTargetUp
                ? "예: 신규 사업 기대감으로 상승 이벤트가 시작되었어요."
                : "예: 실적 부진 우려로 하락 이벤트가 시작되었어요."}
            />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="checkbox"
            className="checkbox checkbox-primary rounded-lg"
            checked={target.publishNews}
            onChange={(e) => setTarget((c) => ({ ...c, publishNews: e.target.checked }))}
            id={`tgt-publish-${stock.id}`}
          />
          <label htmlFor={`tgt-publish-${stock.id}`} className="text-xs font-bold text-base-content/70 cursor-pointer">
            시장 공지 발행 및 행운소식 등록
          </label>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm font-bold text-base-content/60">
            예상 방향:{" "}
            {isTargetUp === null ? "-" : isTargetUp ? (
              <span className="text-success font-black">상승 ▲</span>
            ) : (
              <span className="text-error font-black">하락 ▼</span>
            )}
          </span>
          <button
            type="button"
            className="btn btn-primary h-12 whitespace-nowrap rounded-2xl px-6"
            disabled={busy || target.targetPrice === "" || target.percentPerTick === ""}
            onClick={applyTarget}
          >
            {busy ? <span className="loading loading-spinner loading-sm" /> : "목표주가 이벤트 시작"}
          </button>
        </div>
      </AccordionCard>

      {/* 3. Blue Chip Accordion */}
      <AccordionCard
        title={stock.is_bluechip === 1 ? "우량주 관리" : "우량주 선정"}
        eyebrow="BLUE CHIP CONTROL"
        badge={stock.is_bluechip === 1 ? "⭐ 우량주" : `현재가 ${formatMoney(currentPrice)}`}
        badgeClass={stock.is_bluechip === 1 ? "badge-warning" : "badge-info badge-outline"}
        isOpen={openSection === "bluechip"}
        onToggle={() => toggle("bluechip")}
        className="mt-3"
      >
        {stock.is_bluechip === 1 ? (
          <div>
            <div className="rounded-2xl bg-warning/10 border border-warning/20 p-4 mb-4">
              <p className="font-black text-sm text-warning mb-2">현재 우량주로 선정된 종목이에요.</p>
              {blueChipRampActive && (
                <div className="grid grid-cols-2 gap-2 text-sm mt-2">
                  <div><span className="text-base-content/50 text-xs">목표주가</span><br /><strong className="font-black tabular-nums">{formatMoney(stock.blueChipTargetPrice || stock.blue_chip_target_price)}</strong></div>
                  <div>
                    <span className="text-base-content/50 text-xs">도달률</span><br />
                    <strong className="font-black tabular-nums text-info">
                      {Math.min(100, Math.floor((currentPrice / (stock.blueChipTargetPrice || stock.blue_chip_target_price || 1)) * 100))}%
                    </strong>
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              className="btn btn-warning btn-outline rounded-2xl w-full h-12"
              disabled={busy}
              onClick={revokeBlueChip}
            >
              {busy ? <span className="loading loading-spinner loading-sm" /> : "우량주 해제"}
            </button>
          </div>
        ) : (
          <>
            <div className="rounded-2xl bg-base-200/50 p-3 text-sm mb-3">
              <span className="text-xs font-bold text-base-content/50">현재가</span>
              <strong className="block text-primary text-base font-black">{formatMoney(currentPrice)}</strong>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="form-control">
                <span className="label-text mb-1 font-bold">목표주가</span>
                <input
                  className="input input-bordered w-full h-12 rounded-2xl"
                  type="number" min="1"
                  value={blueChip.targetPrice}
                  onChange={(e) => setBlueChip((c) => ({ ...c, targetPrice: e.target.value }))}
                  placeholder="예: 30000"
                />
              </label>
              <label className="form-control">
                <span className="label-text mb-1 font-bold">tick당 상승률 (%)</span>
                <input
                  className="input input-bordered w-full h-12 rounded-2xl"
                  type="number" min="1" max="100"
                  value={blueChip.rampPercent}
                  onChange={(e) => setBlueChip((c) => ({ ...c, rampPercent: e.target.value }))}
                  placeholder="예: 30"
                />
              </label>
              <label className="form-control min-w-0">
                <span className="label-text mb-1 font-bold">사유</span>
                <input
                  className="input input-bordered w-full h-12 rounded-2xl"
                  value={blueChip.reason}
                  onChange={(e) => setBlueChip((c) => ({ ...c, reason: e.target.value }))}
                  placeholder="예: 우량주 편입 이벤트"
                  maxLength={120}
                />
              </label>
              <label className="form-control min-w-0">
                <span className="label-text mb-1 block font-bold">공지 제목 (선택)</span>
                <input
                  className="input input-bordered w-full h-12 min-w-0 rounded-2xl"
                  value={blueChip.newsTitle}
                  onChange={(e) => setBlueChip((c) => ({ ...c, newsTitle: e.target.value }))}
                  placeholder="예: 우량주 지정 및 특별 혜택"
                  maxLength={100}
                />
              </label>
              <label className="form-control min-w-0 lg:col-span-2">
                <span className="label-text mb-1 block font-bold">공지 내용 (선택)</span>
                <textarea
                  className="textarea textarea-bordered w-full min-w-0 rounded-2xl py-2 min-h-[48px]"
                  value={blueChip.newsContent}
                  onChange={(e) => setBlueChip((c) => ({ ...c, newsContent: e.target.value }))}
                  placeholder={(() => {
                    const moneyText = blueChip.targetPrice ? Number(blueChip.targetPrice).toLocaleString("ko-KR") : "0";
                    return `예: ${stock.name}이(가) 우량주로 선정되었어요. 목표주가 ${moneyText}원을 향해 상승 이벤트가 시작됩니다.`;
                  })()}
                />
              </label>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <input
                type="checkbox"
                className="checkbox checkbox-primary rounded-lg"
                checked={blueChip.publishNews}
                onChange={(e) => setBlueChip((c) => ({ ...c, publishNews: e.target.checked }))}
                id={`bc-publish-${stock.id}`}
              />
              <label htmlFor={`bc-publish-${stock.id}`} className="text-xs font-bold text-base-content/70 cursor-pointer">
                시장 공지 발행 및 행운소식 등록
              </label>
            </div>
            <button
              type="button"
              className="btn btn-primary rounded-2xl w-full h-12 mt-3"
              disabled={busy || blueChip.targetPrice === "" || blueChip.rampPercent === ""}
              onClick={applyBlueChip}
            >
              {busy ? <span className="loading loading-spinner loading-sm" /> : "⭐ 우량주 선정 및 급등 시작"}
            </button>
          </>
        )}
      </AccordionCard>
    </section>
  );
}

/** Accordion Card sub-component */
function AccordionCard({ title, eyebrow, badge, badgeClass = "badge-info badge-outline", isOpen, onToggle, className = "", children }) {
  return (
    <div className={`rounded-2xl border border-base-200 bg-base-100 overflow-hidden transition-all ${className}`}>
      <button
        type="button"
        className="w-full flex items-center justify-between p-4 hover:bg-base-200/30 transition text-left"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div>
            <p className="text-[10px] font-black tracking-widest text-base-content/40 uppercase">{eyebrow}</p>
            <h4 className="font-black text-sm text-base-content">{title}</h4>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`badge ${badgeClass} font-black text-xs`}>{badge}</span>
          <svg
            className={`w-4 h-4 text-base-content/40 transition-transform ${isOpen ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {isOpen && (
        <div className="px-4 pb-4 pt-1 border-t border-base-200 animate-fade-in">
          {children}
        </div>
      )}
    </div>
  );
}

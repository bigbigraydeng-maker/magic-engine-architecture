'use client';

export default function Error({ reset }: { reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white pt-16">
      <div className="text-center max-w-md px-8">
        <div className="text-5xl mb-6">❄</div>
        <h2 className="text-2xl font-bold text-slate-900 mb-3">页面加载出错</h2>
        <p className="text-slate-500 mb-6 text-sm">可能是网络问题或页面正在更新，请刷新重试。</p>
        <button
          onClick={reset}
          className="bg-cyan-600 hover:bg-cyan-700 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
        >
          重新加载
        </button>
      </div>
    </div>
  );
}

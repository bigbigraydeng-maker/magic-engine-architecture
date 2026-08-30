'use client';

import { useState } from 'react';
import TailorMadeEditor from './TailorMadeEditor';
import BrochureEditor from './BrochureEditor';
import type { TailorMadeRecord } from '@/lib/tailor-made/types';

/**
 * 一份报价单下的两种交付文档。
 *
 * 行程单回答「每天去哪、住哪、多少钱」，画册回答「这些地方长什么样」。
 * 两份发给同一个终端客户，共用客户名和报价编号，所以放在同一个工作区里切换，
 * 而不是两个入口各填一遍。
 *
 * 行程单常驻挂载（顾问的主战场，来回切不该每次重新加载），
 * 画册**打开过才挂载**。
 *
 * 一度两个都常驻，代价是画册预览在顾问还停在行程单时就加载了 —— 那时它在
 * 隐藏容器里，量出来的页高是 0，分页把每一块各排一页：11 页排成 17 页，
 * 中间全是只有一个标题的空白页，而且没有任何报错。
 * 模板那边已经改成「没有布局就不排、等有了再排」，这里不再抢跑是第二道保险。
 */

type Tab = 'itinerary' | 'brochure';

export default function QuoteWorkspace({
  record,
  clientId,
}: {
  record: TailorMadeRecord;
  clientId: string;
}) {
  const [tab, setTab] = useState<Tab>('itinerary');
  // 打开过画册就留着，避免来回切时重复加载；但没打开过就不挂载
  const [brochureOpened, setBrochureOpened] = useState(false);

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-black/10">
        <TabButton active={tab === 'itinerary'} onClick={() => setTab('itinerary')}>
          行程单
        </TabButton>
        <TabButton
          active={tab === 'brochure'}
          onClick={() => {
            setBrochureOpened(true);
            setTab('brochure');
          }}
        >
          画册
          {record.brochure ? (
            <span className="ml-1.5 text-[10px] text-[#5C8A4A]">●</span>
          ) : (
            <span className="ml-1.5 text-[10px] text-me-charcoal/30">未创建</span>
          )}
        </TabButton>
      </div>

      <div hidden={tab !== 'itinerary'}>
        <TailorMadeEditor record={record} clientId={clientId} />
      </div>
      {brochureOpened && (
        <div hidden={tab !== 'brochure'}>
          <BrochureEditor record={record} clientId={clientId} />
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-bold transition ${
        active
          ? 'border-me-ochre text-me-charcoal'
          : 'border-transparent text-me-charcoal/45 hover:text-me-charcoal/70'
      }`}
    >
      {children}
    </button>
  );
}

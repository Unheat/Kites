import { useState } from 'react';
import './index.css';

const MOCK_HISTORY = [
  { id: 1, time: '14:02', title: 'Page_22.png', active: true },
  { id: 2, time: '11:45', title: 'Cover_Art.jpg', active: false },
  { id: 3, time: '09:12', title: 'Chap_01.png', active: false },
];

const MOCK_TRANSLATIONS = [
  { id: 1, x: 20, y: 15, w: 25, h: 10, jp: 'こんにちは', en: 'Hello' },
  { id: 2, x: 60, y: 50, w: 15, h: 20, jp: '世界', en: 'World' },
];

function App() {
  const [hoveredBox, setHoveredBox] = useState<number | null>(null);

  return (
    <div className="flex h-screen w-full font-body overflow-hidden selection:bg-editorial selection:text-vellum">
      
      {/* LEFT SIDEBAR: "Paper" (History/Settings) */}
      <div className="w-[280px] h-full bg-paper flex flex-col border-r border-dust/30">
        <div className="p-6 pb-2">
          <div className="flex items-center justify-between">
            <h1 className="font-display text-2xl font-bold tracking-widest text-ink">KITES</h1>
            <button className="text-ink hover:text-editorial transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-6 py-4 border-b border-dust/20">
          <h2 className="text-xs font-mono tracking-widest text-dust uppercase mb-4">History</h2>
          <ul className="space-y-1">
            {MOCK_HISTORY.map((item) => (
              <li key={item.id}>
                <button
                  className={`w-full text-left flex gap-3 px-2 py-2 rounded-md transition-colors ${
                    item.active
                      ? 'bg-ink text-vellum'
                      : 'text-ink hover:bg-dust/20'
                  }`}
                >
                  <span className={`font-mono text-xs mt-0.5 ${item.active ? 'text-dust' : 'text-dust'}`}>
                    {item.time}
                  </span>
                  <span className="text-sm truncate font-medium">{item.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-auto p-6 border-t border-dust/20">
          <div className="flex items-center gap-2 text-xs font-mono text-ink">
            <div className="w-2 h-2 rounded-full bg-editorial animate-pulse"></div>
            Local Model: Active
          </div>
        </div>
      </div>

      {/* MAIN STAGE: "Glass" (The Image Canvas) */}
      <div className="flex-1 h-full bg-glass relative flex items-center justify-center overflow-hidden">
        
        {/* Mock Image Area (Placeholder) */}
        <div className="relative w-[600px] h-[800px] bg-ink border border-dust/20 shadow-2xl overflow-hidden flex items-center justify-center group">
          <div className="absolute inset-0 opacity-10 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9IiNGRkZGRkYiLz48L3N2Zz4=')]"></div>
          
          <span className="text-dust font-mono text-sm tracking-widest absolute opacity-50 select-none">
            MOCK_MANGA_PAGE.PNG
          </span>

          {/* Translation Bounding Boxes */}
          {MOCK_TRANSLATIONS.map((box) => {
            const isHovered = hoveredBox === box.id;
            return (
              <div
                key={box.id}
                className="absolute transition-all duration-300 cursor-crosshair"
                style={{
                  left: `${box.x}%`,
                  top: `${box.y}%`,
                  width: `${box.w}%`,
                  height: `${box.h}%`,
                }}
                onMouseEnter={() => setHoveredBox(box.id)}
                onMouseLeave={() => setHoveredBox(null)}
              >
                {/* Precise Crop Marks */}
                <div className={`absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 transition-colors duration-300 ${isHovered ? 'border-editorial' : 'border-dust/50'}`}></div>
                <div className={`absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 transition-colors duration-300 ${isHovered ? 'border-editorial' : 'border-dust/50'}`}></div>
                <div className={`absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 transition-colors duration-300 ${isHovered ? 'border-editorial' : 'border-dust/50'}`}></div>
                <div className={`absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 transition-colors duration-300 ${isHovered ? 'border-editorial' : 'border-dust/50'}`}></div>
                
                {/* Text Content */}
                <div className="absolute inset-0 flex items-center justify-center p-2 text-center pointer-events-none">
                  <span
                    className={`absolute text-lg font-bold text-paper transition-opacity duration-300 ${
                      isHovered ? 'opacity-0' : 'opacity-100'
                    }`}
                  >
                    {box.jp}
                  </span>
                  <span
                    className={`absolute text-sm font-semibold text-editorial bg-glass/80 px-2 py-1 backdrop-blur-sm transition-all duration-300 transform ${
                      isHovered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
                    }`}
                  >
                    {box.en}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Floating Tool Palette */}
        <div className="absolute right-6 top-1/2 -translate-y-1/2 bg-ink border border-dust/30 rounded-lg p-2 flex flex-col gap-2 shadow-2xl">
          <button className="p-3 text-dust hover:text-editorial hover:bg-glass rounded transition-colors group relative">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
            <span className="absolute right-full mr-4 bg-vellum text-ink text-xs font-mono px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none tracking-widest">FILTER</span>
          </button>
          <button className="p-3 text-editorial bg-glass rounded transition-colors group relative border border-editorial/30">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            <span className="absolute right-full mr-4 bg-vellum text-ink text-xs font-mono px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none tracking-widest">VIEW</span>
          </button>
          <div className="w-full h-px bg-dust/30 my-1"></div>
          <button className="p-3 text-dust hover:text-editorial hover:bg-glass rounded transition-colors group relative">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
            <span className="absolute right-full mr-4 bg-vellum text-ink text-xs font-mono px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none tracking-widest">EXPORT</span>
          </button>
        </div>

      </div>
    </div>
  );
}

export default App;

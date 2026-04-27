import { useState, useRef, useEffect } from 'react';
import { COLORS } from '../lib/colors';

export default function NewGroupForm({ usedColors, defaultColor, onCancel, onCreate }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(defaultColor);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) { inputRef.current?.focus(); return; }
    onCreate(trimmed, color);
  };

  return (
    <div className="mx-3 my-2 p-3 bg-gray-50 rounded-xl border border-gray-100">
      <input
        ref={inputRef}
        type="text"
        placeholder="Group name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
          if (e.key === 'Escape') onCancel();
        }}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 bg-white text-gray-800 placeholder-gray-400 mb-2.5"
      />

      {/* Color swatches */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {COLORS.map((c) => {
          const taken = usedColors.has(c.hex);
          return (
            <button
              key={c.hex}
              title={taken ? `${c.name} (in use)` : c.name}
              onClick={() => !taken && setColor(c.hex)}
              className={`w-5 h-5 rounded-full border-2 transition-transform ${
                c.hex === color ? 'border-gray-700 scale-125' : 'border-transparent'
              } ${taken ? 'opacity-25 cursor-not-allowed' : 'hover:scale-110 cursor-pointer'}`}
              style={{ background: c.hex }}
            />
          );
        })}
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1 rounded-lg hover:bg-gray-100 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          className="text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium px-3 py-1 rounded-lg transition-colors"
        >
          Create
        </button>
      </div>
    </div>
  );
}

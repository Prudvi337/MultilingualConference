/**
 * Audio Controls Component
 * 
 * Microphone mute/unmute button with visual feedback.
 */

interface AudioControlsProps {
  isMuted: boolean;
  onToggleMute: () => void;
}

export default function AudioControls({ isMuted, onToggleMute }: AudioControlsProps) {
  return (
    <button
      onClick={onToggleMute}
      className={`w-full py-4 px-6 rounded-lg font-medium transition-all shadow-lg ${
        isMuted
          ? 'bg-gray-600 hover:bg-gray-700 text-white'
          : 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white'
      }`}
    >
      <div className="flex items-center justify-center">
        <span className="text-2xl mr-3">
          {isMuted ? '🔇' : '🎤'}
        </span>
        <span className="text-lg">
          {isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
        </span>
      </div>
    </button>
  );
}


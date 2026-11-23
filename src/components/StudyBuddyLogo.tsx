import React, { useState } from 'react';
import { BookOpen } from 'lucide-react';

export const STUDY_BUDDY_LOGO_URL =
  '/assets/aistudio/f5ca178f-3315-45c3-8706-a254a4a07f38__1__0e4df9be.jpeg';

interface StudyBuddyLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showRing?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<StudyBuddyLogoProps['size']>, string> = {
  xs: 'w-7 h-7',
  sm: 'w-9 h-9',
  md: 'w-11 h-11',
  lg: 'w-16 h-16 sm:w-20 sm:h-20',
  xl: 'w-24 h-24 sm:w-28 sm:h-28',
};

export const StudyBuddyLogo: React.FC<StudyBuddyLogoProps> = ({
  size = 'md',
  className = '',
  showRing = true,
}) => {
  const [imgError, setImgError] = useState(false);

  if (imgError) {
    return (
      <div
        className={`${SIZE_CLASSES[size]} rounded-full bg-gradient-to-tr from-sky-600 via-sky-500 to-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm ${className}`}
        aria-label="Study Buddy AI Logo"
      >
        <BookOpen className="w-1/2 h-1/2" />
      </div>
    );
  }

  return (
    <div
      className={`${SIZE_CLASSES[size]} rounded-full bg-white overflow-hidden shrink-0 flex items-center justify-center ${
        showRing ? 'ring-2 ring-slate-200/80 shadow-sm' : ''
      } ${className}`}
    >
      <img
        src={STUDY_BUDDY_LOGO_URL}
        alt="Study Buddy AI — Empowering Working Students Through Quality Education"
        className="w-full h-full object-contain scale-110 select-none"
        referrerPolicy="no-referrer"
        onError={() => setImgError(true)}
      />
    </div>
  );
};

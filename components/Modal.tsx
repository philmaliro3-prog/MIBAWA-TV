import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  show: boolean;
  onClose: () => void;
  title: string;
  message: string;
}

const Modal: React.FC<ModalProps> = ({ show, onClose, title, message }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (show) {
      previouslyFocusedElement.current = document.activeElement as HTMLElement;
      // Delay focus slightly to ensure modal is rendered
      setTimeout(() => closeButtonRef.current?.focus(), 50);

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onClose();
        }
        // Basic focus trap since there is only one focusable element
        if (e.key === 'Tab') {
          e.preventDefault();
        }
      };
      
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        previouslyFocusedElement.current?.focus();
      };
    }
  }, [show, onClose]);


  if (!show) return null;

  return createPortal(
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 transition-opacity duration-300" 
      aria-modal="true" 
      role="dialog"
      aria-labelledby="modal-title"
      aria-describedby="modal-message"
      onClick={onClose}
    >
      <div 
        ref={modalRef}
        className="bg-white dark:bg-slate-800 rounded-lg shadow-xl p-6 w-full max-w-md transform transition-all duration-300 scale-95 opacity-0 animate-fade-in-scale"
        onClick={e => e.stopPropagation()}
      >
        <style>{`
          @keyframes fadeInScale {
            from { opacity: 0; transform: scale(0.95); }
            to { opacity: 1; transform: scale(1); }
          }
          .animate-fade-in-scale { animation: fadeInScale 0.3s forwards cubic-bezier(0.16, 1, 0.3, 1); }
        `}</style>
        <h3 id="modal-title" className="text-xl font-bold text-gray-800 dark:text-slate-100">{title}</h3>
        <p id="modal-message" className="mt-2 text-gray-600 dark:text-slate-300">{message}</p>
        <div className="mt-6 flex justify-end">
          <button 
            ref={closeButtonRef}
            onClick={onClose} 
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default Modal;
import React, { useState, useRef } from 'react';
import {
  X,
  Upload,
  FileText,
  Check,
  AlertCircle,
  BookOpen,
  Sparkles,
  Loader2,
  Presentation,
  Table,
  FileSpreadsheet,
  FileType,
  File,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
} from 'lucide-react';
import { LessonDocument } from '../types';
import { DEFAULT_LESSONS } from '../data/defaultLessons';
import { parseDocumentFile } from '../services/api';
import { addLesson } from '../services/storage';
import {
  supabase,
  checkIsConfigured,
  STORAGE_BUCKET,
  setCurrentLearningMaterialId,
  ensureUserProfileAndProgress,
  notifyDataChanged,
} from '../lib/supabase';
import { AudioTeachingPlayer } from './AudioTeachingPlayer';

interface UploadLessonModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLessonUploaded: (lesson: LessonDocument) => void;
}

export const UploadLessonModal: React.FC<UploadLessonModalProps> = ({
  isOpen,
  onClose,
  onLessonUploaded,
}) => {
  const isSubmittingRef = useRef(false);
  const [activeTab, setActiveTab] = useState<'upload' | 'samples'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extractedPreview, setExtractedPreview] = useState<{
    totalPages: number;
    pages: { pageNumber: number; text: string }[];
    chunks?: any[];
    fileType?: string;
  } | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [isSavedConfirmed, setIsSavedConfirmed] = useState<boolean>(false);
  const [showAllSamplesExpanded, setShowAllSamplesExpanded] = useState<boolean>(false);

  if (!isOpen) return null;

  const getFormatBadge = (filename?: string) => {
    if (!filename) return null;
    const ext = (filename.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') {
      return { label: 'PDF Document', color: 'bg-red-100 text-red-800 border-red-200', icon: FileText, unit: 'Pages' };
    }
    if (ext === 'docx' || ext === 'doc') {
      return { label: 'Word Document', color: 'bg-blue-100 text-blue-800 border-blue-200', icon: FileText, unit: 'Pages' };
    }
    if (ext === 'pptx' || ext === 'ppt') {
      return { label: 'PowerPoint Deck', color: 'bg-amber-100 text-amber-800 border-amber-200', icon: Presentation, unit: 'Slides' };
    }
    if (ext === 'xlsx' || ext === 'xls') {
      return { label: 'Excel Spreadsheet', color: 'bg-emerald-100 text-emerald-800 border-emerald-200', icon: FileSpreadsheet, unit: 'Sheets' };
    }
    if (ext === 'csv' || ext === 'tsv') {
      return { label: 'CSV Data Sheet', color: 'bg-teal-100 text-teal-800 border-teal-200', icon: Table, unit: 'Sections' };
    }
    if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
      return { label: 'Study Notes / Text', color: 'bg-slate-100 text-slate-800 border-slate-200', icon: FileType, unit: 'Sections' };
    }
    return { label: ext.toUpperCase() + ' File', color: 'bg-sky-100 text-sky-800 border-sky-200', icon: File, unit: 'Sections' };
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    if (!title) {
      setTitle(selectedFile.name.replace(/\.[^/.]+$/, ''));
    }
    if (!subject) {
      setSubject('General College Course');
    }

    setLoading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = reader.result as string;
          const parsed = await parseDocumentFile(base64, selectedFile.name, selectedFile.type);
          setExtractedPreview({
            totalPages: parsed.totalPages,
            pages: parsed.pages,
            chunks: parsed.chunks,
            fileType: parsed.fileType,
          });
        } catch (err: any) {
          setError(err.message || 'Could not parse document. Please check the file.');
        } finally {
          setLoading(false);
        }
      };
      reader.onerror = () => {
        setError('Failed to read the local file from disk.');
        setLoading(false);
      };
      reader.readAsDataURL(selectedFile);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (isSubmittingRef.current || loading) return;
    if (!extractedPreview || extractedPreview.pages.length === 0) {
      setError('Please select a valid study document with readable text content.');
      return;
    }
    isSubmittingRef.current = true;

    const lessonId = `lesson-${Date.now()}`;
    const ext = (file?.name.split('.').pop() || '').toLowerCase();
    const lessonTitle = title.trim() || file?.name || 'Untitled Lesson Material';
    const newLesson: LessonDocument = {
      id: lessonId,
      title: lessonTitle,
      subject: subject.trim() || 'General Course',
      totalPages: extractedPreview.totalPages,
      uploadedAt: new Date().toISOString(),
      pages: extractedPreview.pages,
      chunks: extractedPreview.chunks || [],
      isSample: false,
      fileType: extractedPreview.fileType || ext,
      fileName: file?.name,
    };

    // When a file is uploaded, enforce authenticated user save
    if (file) {
      setLoading(true);
      setError(null);
      setIsSavedConfirmed(false);
      setUploadStatus(`Authenticating student session...`);

      // 1. AUTHENTICATED USER
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (!user) {
        setLoading(false);
        isSubmittingRef.current = false;
        setUploadStatus('');
        setError('Please sign in to save your activity.');
        return;
      }

      try {
        await ensureUserProfileAndProgress(user);
        setUploadStatus(`Uploading ${file.name} to ${STORAGE_BUCKET}...`);

        const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `${user.id}/${Date.now()}_${cleanFileName}`;

        // Upload to storage bucket
        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, file, {
            cacheControl: '3600',
            upsert: true,
          });

        if (uploadError) {
          console.error('Storage upload failed:', uploadError);
          setError(`Storage upload failed: ${uploadError.message}`);
          setLoading(false);
          isSubmittingRef.current = false;
          setUploadStatus('');
          return;
        }

        // 2. LEARNING MATERIAL DATABASE SAVE
        // Immediately insert its information into learning_materials
        // Use exact existing columns: user_id, title, file_name, file_path, total_pages
        setUploadStatus(`Registering record in learning_materials...`);
        const { data: material, error: materialError } = await supabase
          .from('learning_materials')
          .insert({
            user_id: user.id,
            title: lessonTitle || file.name,
            file_name: file.name,
            file_path: storagePath,
            total_pages: extractedPreview.totalPages || null,
          })
          .select()
          .single();

        if (materialError) {
          console.error(
            'Learning material database save failed:',
            materialError
          );
          console.error('Material DB error:', materialError);
          setError(`Learning material database save failed: ${materialError.message}`);
          setIsSavedConfirmed(false);
          setLoading(false);
          isSubmittingRef.current = false;
          setUploadStatus('');
          // DO NOT show "Saved".
          return;
        }

        // If successful: store material.id as the current learning material ID.
        if (material?.id) {
          setCurrentLearningMaterialId(material.id);
          newLesson.id = material.id;
          newLesson.filePath = storagePath;
        }

        // Only display "Saved" after Supabase confirms the insert succeeded.
        setIsSavedConfirmed(true);
        setUploadStatus('Saved');
        notifyDataChanged();
      } catch (err: any) {
        console.error('Learning material database save failed:', err);
        console.error('Material DB error:', err);
        setError(err.message || 'Failed to save learning material.');
        setIsSavedConfirmed(false);
        setLoading(false);
        isSubmittingRef.current = false;
        setUploadStatus('');
        return;
      } finally {
        setLoading(false);
        isSubmittingRef.current = false;
      }
    }

    addLesson(newLesson);
    onLessonUploaded(newLesson);

    // Give visual confirmation of the Saved status before closing
    setTimeout(() => {
      onClose();
    }, 600);
  };

  const handleSelectSample = (sample: LessonDocument) => {
    addLesson(sample);
    onLessonUploaded(sample);
    onClose();
  };

  const currentBadge = getFormatBadge(file?.name);
  const CurrentIcon = currentBadge?.icon || FileText;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-sky-100 max-w-xl w-full overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-sky-800 to-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-sky-500/20 rounded-lg text-sky-300 border border-sky-400/30">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">Upload Learning Material</h3>
              <p className="text-xs text-sky-200/80">
                Supports PDF, Word (DOCX), PowerPoint (PPTX), Excel/CSV & Text
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switch */}
        <div className="px-6 pt-3 pb-1 border-b border-slate-100 flex space-x-4 bg-slate-50/50 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('upload')}
            className={`pb-2.5 border-b-2 transition-colors ${
              activeTab === 'upload'
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Upload Course Material
          </button>
          <button
            onClick={() => setActiveTab('samples')}
            className={`pb-2.5 border-b-2 transition-colors flex items-center space-x-1.5 ${
              activeTab === 'samples'
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>Select Course Preset (Fast Demo)</span>
          </button>
        </div>

        {/* Content body */}
        <div className="p-6 overflow-y-auto flex-1">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-2 text-xs text-red-800">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {activeTab === 'upload' ? (
            <div className="space-y-4">
              {/* Supported formats showcase bar */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600 pb-1">
                <span className="font-semibold text-slate-700">Supported:</span>
                <span className="px-2 py-0.5 bg-red-50 text-red-700 rounded-md border border-red-100 font-medium">.PDF</span>
                <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-md border border-blue-100 font-medium">.DOCX / .DOC</span>
                <span className="px-2 py-0.5 bg-amber-50 text-amber-800 rounded-md border border-amber-100 font-medium">.PPTX / .PPT</span>
                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 rounded-md border border-emerald-100 font-medium">.XLSX / .CSV</span>
                <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md border border-slate-200 font-medium">.TXT / .MD</span>
              </div>

              {/* Drop area */}
              <label className="border-2 border-dashed border-sky-300 hover:border-sky-500 bg-sky-50/40 hover:bg-sky-50/80 rounded-2xl p-6 text-center cursor-pointer transition-colors block">
                <input
                  type="file"
                  accept=".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.csv,.tsv,.txt,.md,.markdown,.rtf"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="flex flex-col items-center">
                  <div className="p-3 bg-sky-100 text-sky-700 rounded-2xl mb-2">
                    <CurrentIcon className="w-8 h-8" />
                  </div>
                  <span className="text-sm font-semibold text-slate-800">
                    {file ? file.name : 'Click to select or drop your course material here'}
                  </span>
                  <span className="text-xs text-slate-500 mt-1">
                    Accepts PDFs, Word docs, PowerPoint presentations, Excel spreadsheets, CSVs, and notes (up to 50MB)
                  </span>
                  {currentBadge && (
                    <span className={`mt-2 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${currentBadge.color}`}>
                      Detected: {currentBadge.label}
                    </span>
                  )}
                </div>
              </label>

              {loading && (
                <div className="p-4 bg-sky-50 rounded-xl flex items-center justify-center space-x-3 text-sm text-sky-700 font-medium">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Extracting sections and citation pages for AI practice...</span>
                </div>
              )}

              {extractedPreview && (
                <div className="p-4 bg-emerald-50/80 border border-emerald-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-emerald-800">
                    <div className="flex items-center space-x-1.5">
                      <Check className="w-4 h-4 text-emerald-600" />
                      <span>
                        Successfully Extracted {extractedPreview.totalPages}{' '}
                        {currentBadge?.unit || 'Pages'}
                      </span>
                    </div>
                    <span className="text-emerald-700 font-medium">Ready for AI processing</span>
                  </div>
                  <p className="text-xs text-slate-600 line-clamp-2 italic bg-white/80 p-2 rounded-lg border border-emerald-100 font-serif">
                    "{extractedPreview.pages[0]?.text.slice(0, 180)}..."
                  </p>

                  <div className="pt-2">
                    <AudioTeachingPlayer
                      id="upload-preview-audio"
                      title={`Audio Teaching Preview: ${title || file?.name || 'Uploaded Material'}`}
                      subtitle="Listen to a preview of your uploaded material before finishing upload."
                      textToSpeak={`Here is the introductory excerpt from your uploaded material ${title || file?.name || ''}: ${extractedPreview.pages[0]?.text.slice(0, 350)}`}
                      variant="compact"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Material / Lesson Title
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Lecture 4: Database Normalization"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Course / Subject
                  </label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="e.g. Information Management"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-sky-50 border border-sky-200/80 rounded-xl p-3">
                <div>
                  <span className="text-xs font-bold text-sky-900 block">
                    4 Authentic Course Samples Available
                  </span>
                  <p className="text-[11px] text-sky-700">
                    Choose any of these pre-loaded lessons to immediately test Summarization, Full Audio Narration, Quizzes, and Study Buddy.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAllSamplesExpanded((prev) => !prev)}
                  className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-colors shrink-0 shadow-xs cursor-pointer self-start sm:self-center"
                >
                  {showAllSamplesExpanded ? (
                    <>
                      <EyeOff className="w-3.5 h-3.5" />
                      <span>Collapse All</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-3.5 h-3.5" />
                      <span>Open All Samples (Full Preview)</span>
                    </>
                  )}
                </button>
              </div>

              {DEFAULT_LESSONS.slice(0, 4).map((sample, idx) => (
                <div
                  key={sample.id}
                  className="border border-slate-200 hover:border-sky-400 bg-white rounded-xl transition-all shadow-sm overflow-hidden"
                >
                  <div
                    onClick={() => handleSelectSample(sample)}
                    className="p-3.5 hover:bg-sky-50/50 cursor-pointer flex items-start justify-between group"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                          Sample {idx + 1}
                        </span>
                        <span className="text-xs font-bold text-slate-800 group-hover:text-sky-800">
                          {sample.title}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">{sample.subject}</p>
                      <div className="flex items-center space-x-3 text-[11px] text-slate-400 pt-1">
                        <span>{sample.totalPages} Pages</span>
                        <span>•</span>
                        <span className="text-emerald-700 font-medium">Full page text & citations included</span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectSample(sample);
                        }}
                        className="px-3.5 py-1.5 text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white rounded-lg transition-colors shadow-xs"
                      >
                        Use Lesson
                      </button>
                    </div>
                  </div>

                  {/* Expanded detail section shown when Open All is active */}
                  {showAllSamplesExpanded && (
                    <div className="px-4 py-3 bg-slate-50 border-t border-slate-200/80 text-xs space-y-2.5">
                      <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 border-b border-slate-200 pb-1.5">
                        <span>Document Overview ({sample.totalPages} Pages Extracted):</span>
                        <span className="text-sky-700 font-mono">ID: {sample.id}</span>
                      </div>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {sample.pages.map((p) => (
                          <div key={p.pageNumber} className="bg-white border border-slate-200 rounded-lg p-2 space-y-1">
                            <span className="text-[10px] font-bold text-sky-800 uppercase block">
                              Page {p.pageNumber}:
                            </span>
                            <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed">
                              {p.text}
                            </p>
                          </div>
                        ))}
                      </div>
                      <div className="pt-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleSelectSample(sample)}
                          className="px-3 py-1 bg-sky-100 hover:bg-sky-200 text-sky-800 rounded-md text-xs font-bold transition-colors"
                        >
                          Select and Load "{sample.title}" →
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {activeTab === 'upload' && (
          <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center space-x-2 text-xs">
              {isSavedConfirmed ? (
                <span className="inline-flex items-center space-x-1.5 px-3 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Saved</span>
                </span>
              ) : uploadStatus ? (
                <div className="flex items-center space-x-1.5 text-sky-700 font-medium">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600" />
                  <span>{uploadStatus}</span>
                </div>
              ) : error ? (
                <div className="flex items-center space-x-1.5 text-red-600 font-medium">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : (
                <span className="text-slate-500">Ready to upload to study-buddy-materials</span>
              )}
            </div>
            <div className="flex space-x-2 shrink-0">
              <button
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!extractedPreview || loading}
                className="px-4 py-2 text-xs font-semibold bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white rounded-xl shadow-sm transition-all cursor-pointer flex items-center space-x-1.5"
              >
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Save & Load Lesson</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

import { useState, useRef, useEffect } from 'react'
import { Plus, Folder, MoreVertical, Trash2, Pencil, Sparkles, Video, MessageSquare, Film, Zap, Languages, Palette } from 'lucide-react'
import { useProjects } from '../contexts/ProjectContext'
import { useI18n } from '../contexts/I18nContext'
import { LtxLogo } from '../components/LtxLogo'
import { Button } from '../components/ui/button'
import type { Project } from '../types/project'

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function ProjectCard({ project, onOpen, onDelete, onRename }: {
  project: Project
  onOpen: () => void
  onDelete: () => void
  onRename: () => void
}) {
  const { t } = useI18n()
  const [showMenu, setShowMenu] = useState(false)

  // Use persisted thumbnail from first video/image asset
  const coverUrl = (() => {
    const videoAsset = project.assets.find(a => a.type === 'video' && a.thumbnail)
    if (videoAsset) return videoAsset.thumbnail
    const imageAsset = project.assets.find(a => a.type === 'image')
    if (imageAsset) return imageAsset.url
    return null
  })()

  return (
    <div
      className="group relative bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-700 transition-colors cursor-pointer"
      onClick={onOpen}
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-zinc-800 flex items-center justify-center relative overflow-hidden">
        {coverUrl ? (
          <img src={coverUrl} alt={project.name} className="w-full h-full object-cover" />
        ) : (
          <Video className="h-12 w-12 text-zinc-600" />
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      
      {/* Info */}
      <div className="p-3">
        <h3 className="font-medium text-white truncate">{project.name}</h3>
        <p className="text-xs text-zinc-500 mt-1">{formatDate(project.updatedAt)}</p>
      </div>
      
      {/* Menu button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          setShowMenu(!showMenu)
        }}
        className="absolute top-2 right-2 p-1.5 rounded bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
      >
        <MoreVertical className="h-4 w-4 text-white" />
      </button>
      
      {/* Dropdown menu */}
      {showMenu && (
        <div 
          className="absolute top-10 right-2 bg-zinc-800 rounded-lg shadow-lg border border-zinc-700 py-1 z-10 min-w-[120px]"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { onRename(); setShowMenu(false) }}
            className="w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
          >
            <Pencil className="h-4 w-4" />
            {t('home.rename')}
          </button>
          <button
            onClick={() => { onDelete(); setShowMenu(false) }}
            className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-zinc-700 flex items-center gap-2"
          >
            <Trash2 className="h-4 w-4" />
            {t('home.delete')}
          </button>
        </div>
      )}
    </div>
  )
}

export function Home() {
  const { t, lang, setLang } = useI18n()
  const { projects, createProject, deleteProject, renameProject, openProject, openPlayground } = useProjects()
  const [isCreating, setIsCreating] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const newProjectInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // 手动聚焦：autoFocus 在 React 重复挂载时不可靠
  useEffect(() => {
    if (isCreating && newProjectInputRef.current) {
      setTimeout(() => newProjectInputRef.current?.focus(), 50)
    }
  }, [isCreating])

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      setTimeout(() => renameInputRef.current?.focus(), 50)
    }
  }, [renamingId])

  const ILLEGAL_CHARS = /[<>:"/\\|?*]/
  const [projectNameError, setProjectNameError] = useState('')
  const [renameError, setRenameError] = useState('')

  const validateProjectName = (name: string, excludeId?: string): string => {
    if (!name.trim()) return ''
    if (ILLEGAL_CHARS.test(name)) {
      return `项目名不能包含字符：< > : " / \\ | ? *`
    }
    const duplicate = projects.find(
      p => p.name.toLowerCase() === name.trim().toLowerCase() && p.id !== excludeId
    )
    if (duplicate) return `项目名「${name.trim()}」已存在`
    return ''
  }

  const handleCreateProject = () => {
    const name = newProjectName.trim()
    if (!name) return
    const err = validateProjectName(name)
    if (err) { setProjectNameError(err); return }
    const project = createProject(name)
    setNewProjectName('')
    setProjectNameError('')
    setIsCreating(false)
    openProject(project.id)
  }

  const handleRenameProject = (id: string, currentName: string) => {
    setRenamingId(id)
    setRenameValue(currentName)
    setRenameError('')
  }

  const submitRename = () => {
    const name = renameValue.trim()
    if (!name) return
    const err = validateProjectName(name, renamingId!)
    if (err) { setRenameError(err); return }
    renameProject(renamingId!, name)
    setRenamingId(null)
    setRenameValue('')
    setRenameError('')
  }
  
  return (
    <div className="h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-zinc-800 flex flex-col">
        <div className="p-6">
          <LtxLogo className="h-6 w-auto text-white" />
        </div>
        
        <nav className="flex-1 px-3">
          <button className="w-full px-3 py-2 rounded-lg bg-zinc-800 text-white text-left text-sm font-medium flex items-center gap-2">
            <Folder className="h-4 w-4" />
            {t('home.home')}
          </button>

          <div className="mt-6">
            <h4 className="px-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
              {t('home.quickActions')}
            </h4>
            <button
              onClick={openPlayground}
              className="w-full px-3 py-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white text-left text-sm flex items-center gap-2 transition-colors"
            >
              <Sparkles className="h-4 w-4" />
              {t('home.playground')}
            </button>
          </div>

          {projects.length > 0 && (
            <div className="mt-6">
              <h4 className="px-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                {t('home.recentProjects')}
              </h4>
              {projects.slice(0, 5).map(project => (
                <button
                  key={project.id}
                  onClick={() => openProject(project.id)}
                  className="w-full px-3 py-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white text-left text-sm flex items-center gap-2 transition-colors truncate"
                >
                  <Folder className="h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{project.name}</span>
                </button>
              ))}
            </div>
          )}
        </nav>
        
        <div className="p-4 border-t border-zinc-800">
          <button
            onClick={() => setIsCreating(true)}
            className="w-full px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          >
            <Plus className="h-4 w-4" />
            {t('home.newProject')}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {/* Header Banner with video background */}
        <div className="relative h-72 overflow-hidden">
          <video
            src="./hero-video.mp4"
            autoPlay
            loop
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
          />
          {/* Dark overlay for text readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/10" />
          <div className="absolute bottom-6 left-8 z-10">
            <h1 className="text-3xl font-bold text-white mb-2 drop-shadow-lg">JianJiCode</h1>
            <p className="text-zinc-200 drop-shadow-md">{t('home.tagline')}</p>
          </div>
        </div>

        {/* Projects Grid */}
        <div className="p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-white">{t('home.projects')}</h2>
          </div>

          {projects.length === 0 ? (
            <div className="text-center py-16">
              <Folder className="h-16 w-16 text-zinc-700 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-zinc-400 mb-2">{t('home.noProjects')}</h3>
              <p className="text-zinc-500 mb-6">{t('home.createFirst')}</p>
              <Button
                onClick={() => setIsCreating(true)}
                className="bg-blue-600 hover:bg-blue-500"
              >
                <Plus className="h-4 w-4 mr-2" />
                {t('home.createProject')}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {projects.map(project => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onOpen={() => openProject(project.id)}
                  onDelete={() => {
                    if (confirm(t('home.confirmDelete', { name: project.name }))) {
                      deleteProject(project.id)
                    }
                  }}
                  onRename={() => handleRenameProject(project.id, project.name)}
                />
              ))}
            </div>
          )}
        </div>
      </main>
      
      {/* Create Project Modal */}
      {isCreating && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-zinc-900 rounded-xl p-6 w-full max-w-md border border-zinc-800">
            <h2 className="text-xl font-semibold text-white mb-4">{t('home.createNewProject')}</h2>
            <input
              ref={newProjectInputRef}
              type="text"
              value={newProjectName}
              onChange={(e) => { setNewProjectName(e.target.value); setProjectNameError('') }}
              placeholder={t('home.projectName')}
              className={`w-full px-4 py-3 rounded-lg bg-zinc-800 border text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 ${projectNameError ? 'border-red-500' : 'border-zinc-700'}`}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
            />
            {projectNameError && (
              <p className="text-red-400 text-xs mt-2">{projectNameError}</p>
            )}
            <div className="flex gap-3 mt-4">
              <Button
                variant="outline"
                onClick={() => { setIsCreating(false); setNewProjectName(''); setProjectNameError('') }}
                className="flex-1 border-zinc-700"
              >
                {t('home.cancel')}
              </Button>
              <Button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-500"
              >
                {t('home.create')}
              </Button>
            </div>
          </div>
        </div>
      )}
      
      {/* Rename Modal */}
      {renamingId && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-zinc-900 rounded-xl p-6 w-full max-w-md border border-zinc-800">
            <h2 className="text-xl font-semibold text-white mb-4">{t('home.renameProject')}</h2>
            <input
              ref={renameInputRef}
              type="text"
              value={renameValue}
              onChange={(e) => { setRenameValue(e.target.value); setRenameError('') }}
              placeholder={t('home.projectName')}
              className={`w-full px-4 py-3 rounded-lg bg-zinc-800 border text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 ${renameError ? 'border-red-500' : 'border-zinc-700'}`}
              onKeyDown={(e) => e.key === 'Enter' && submitRename()}
            />
            {renameError && (
              <p className="text-red-400 text-xs mt-2">{renameError}</p>
            )}
            <div className="flex gap-3 mt-4">
              <Button
                variant="outline"
                onClick={() => { setRenamingId(null); setRenameValue(''); setRenameError('') }}
                className="flex-1 border-zinc-700"
              >
                {t('home.cancel')}
              </Button>
              <Button
                onClick={submitRename}
                disabled={!renameValue.trim() || !!renameError}
                className="flex-1 bg-blue-600 hover:bg-blue-500"
              >
                {t('home.save')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Floating quick menu */}
      <div className="fixed bottom-8 right-8 z-50 group">
        <div className="absolute bottom-14 right-0 flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto">
          <button onClick={() => setIsCreating(true)} className="w-40 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm text-left hover:bg-zinc-700 transition-colors shadow-lg flex items-center gap-2">
            <Plus className="h-4 w-4 text-blue-400" />{t('home.newProject')}
          </button>
          <div className="h-px bg-zinc-700 mx-1" />
          <button onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} className="w-40 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm text-left hover:bg-zinc-700 transition-colors shadow-lg flex items-center gap-2">
            <Languages className="h-4 w-4 text-green-400" />{lang === 'zh' ? 'Switch to English' : '切换中文'}
          </button>
          <button className="w-40 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm text-left hover:bg-zinc-700 transition-colors shadow-lg flex items-center gap-2 opacity-50 cursor-not-allowed">
            <Palette className="h-4 w-4 text-orange-400" />主题切换
          </button>
        </div>
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/25 cursor-pointer hover:scale-110 transition-transform">
          <Sparkles className="h-6 w-6 text-white" />
        </div>
      </div>
    </div>
  )
}

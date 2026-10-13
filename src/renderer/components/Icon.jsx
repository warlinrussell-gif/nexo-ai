import * as L from 'lucide-react';

const MAP = {
  chat: L.MessageSquare, models: L.Boxes, bot: L.Bot, sparkles: L.Sparkles, skills: L.BookOpen, plug: L.Plug, cpu: L.Cpu, settings: L.Settings,
  sun: L.Sun, moon: L.Moon, search: L.Search, plus: L.Plus, trash: L.Trash2, pencil: L.Pencil, pin: L.Pin, 'pin-off': L.PinOff, copy: L.Copy,
  check: L.Check, x: L.X, 'chevron-right': L.ChevronRight, 'chevron-down': L.ChevronDown, 'chevron-left': L.ChevronLeft, 'chevron-up': L.ChevronUp,
  'arrow-up': L.ArrowUp, stop: L.Square, paperclip: L.Paperclip, mic: L.Mic, 'mic-off': L.MicOff, 'audio-lines': L.AudioLines, globe: L.Globe,
  'mouse-pointer-click': L.MousePointerClick, code: L.Code, network: L.Network, download: L.Download, pause: L.Pause, play: L.Play,
  regenerate: L.RotateCcw, refresh: L.RefreshCw, external: L.ExternalLink, 'folder-open': L.FolderOpen, folder: L.Folder, disk: L.HardDrive,
  ram: L.MemoryStick, gauge: L.Gauge, zap: L.Zap, eye: L.Eye, wrench: L.Wrench, brain: L.Brain, layers: L.Layers, terminal: L.Terminal,
  file: L.FileText, image: L.Image, monitor: L.Monitor, 'panel-left': L.PanelLeft, 'panel-right': L.PanelRight, 'arrow-down': L.ArrowDown,
  volume: L.Volume2, 'volume-x': L.VolumeX, shield: L.Shield, 'shield-check': L.ShieldCheck, 'shield-alert': L.ShieldAlert, key: L.Key, star: L.Star,
  filter: L.Filter, sliders: L.SlidersHorizontal, info: L.Info, alert: L.TriangleAlert, 'check-circle': L.CircleCheck, circle: L.Circle,
  loader: L.LoaderCircle, server: L.Server, link: L.Link, wand: L.WandSparkles, workflow: L.Workflow, columns: L.Columns2, branch: L.GitBranch,
  command: L.Command, power: L.Power, upload: L.Upload, 'arrow-left': L.ArrowLeft, 'arrow-right': L.ArrowRight, keyboard: L.Keyboard,
  clipboard: L.Clipboard, bell: L.Bell, list: L.List, activity: L.Activity, trending: L.TrendingUp, flame: L.Flame, user: L.User, radio: L.Radio,
  headphones: L.Headphones, library: L.Library, package: L.Package, 'circle-stop': L.CircleStop, more: L.Ellipsis, save: L.Save, laptop: L.Laptop,
  cloud: L.Cloud, 'cloud-download': L.CloudDownload, rocket: L.Rocket, 'list-checks': L.ListChecks, 'circle-dot': L.CircleDot, clock: L.Clock,
  database: L.Database, lock: L.Lock, unlock: L.Unlock, 'arrow-up-right': L.ArrowUpRight, hash: L.Hash, palette: L.Palette, languages: L.Languages,
  share: L.Share2, 'file-down': L.FileDown, minus: L.Minus, maximize: L.Maximize2, minimize: L.Minimize2, history: L.History, 'scan-eye': L.ScanEye,
  home: L.House, 'message-plus': L.MessageSquarePlus
};

export default function Icon({ name, size = 16, className, style, strokeWidth = 1.9 }) {
  const C = MAP[name] || L.Circle;
  return <C size={size} className={className} style={style} strokeWidth={strokeWidth} />;
}

export const TOOL_ICONS = {
  read_file: 'file', write_file: 'save', edit_file: 'pencil', list_directory: 'folder-open', search_files: 'search', move_path: 'arrow-right', delete_path: 'trash',
  run_command: 'terminal', open_app: 'rocket', system_info: 'cpu', list_processes: 'activity', kill_process: 'circle-stop', clipboard_read: 'clipboard', clipboard_write: 'clipboard', notify: 'bell',
  computer: 'mouse-pointer-click', web_search: 'search', fetch_url: 'globe', browser: 'globe', memory_save: 'brain', memory_forget: 'brain', use_skill: 'skills',
  update_plan: 'list-checks', delegate_task: 'network'
};

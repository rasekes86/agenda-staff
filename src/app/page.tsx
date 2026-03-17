'use client'

import { useState, useEffect } from 'react'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Plus, Trash2, Edit2, Download, Chrome, Users, Clock, CalendarDays, CheckCircle2 } from 'lucide-react'

interface CalendarEvent {
  id: string
  title: string
  description?: string
  date: string
  time?: string
  color: string
  createdAt: string
  updatedAt: string
}

export default function Home() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    time: '',
    color: '#3b82f6'
  })

  // Load events from API
  const loadEvents = async () => {
    try {
      const response = await fetch('/api/calendar/events')
      if (response.ok) {
        const data = await response.json()
        setEvents(data)
      }
    } catch (error) {
      console.error('Error loading events:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadEvents()
    // Set up periodic refresh
    const interval = setInterval(loadEvents, 10000)
    return () => clearInterval(interval)
  }, [])

  // Get events for selected date
  const selectedDateKey = selectedDate.toISOString().split('T')[0]
  const dayEvents = events.filter(e => e.date === selectedDateKey)

  // Check if a date has events
  const hasEvents = (date: Date) => {
    const dateKey = date.toISOString().split('T')[0]
    return events.some(e => e.date === dateKey)
  }

  // Get event colors for a date
  const getEventColors = (date: Date) => {
    const dateKey = date.toISOString().split('T')[0]
    return events.filter(e => e.date === dateKey).map(e => e.color)
  }

  // Format date for display
  const formatSelectedDate = () => {
    return selectedDate.toLocaleDateString('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  // Format time for display
  const formatTime = (time?: string) => {
    if (!time) return ''
    const [hours, minutes] = time.split(':')
    const hour = parseInt(hours)
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const hour12 = hour % 12 || 12
    return `${hour12}:${minutes} ${ampm}`
  }

  // Open dialog for new event
  const openNewEventDialog = () => {
    setEditingEvent(null)
    setFormData({ title: '', description: '', time: '', color: '#3b82f6' })
    setDialogOpen(true)
  }

  // Open dialog for editing event
  const openEditEventDialog = (event: CalendarEvent) => {
    setEditingEvent(event)
    setFormData({
      title: event.title,
      description: event.description || '',
      time: event.time || '',
      color: event.color
    })
    setDialogOpen(true)
  }

  // Save event
  const saveEvent = async () => {
    if (!formData.title.trim()) return

    const eventData = {
      id: editingEvent?.id || Date.now().toString(),
      title: formData.title,
      description: formData.description || null,
      date: selectedDateKey,
      time: formData.time || null,
      color: formData.color,
      createdAt: editingEvent?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    // Update local events
    let updatedEvents: CalendarEvent[]
    if (editingEvent) {
      updatedEvents = events.map(e => e.id === editingEvent.id ? eventData : e)
    } else {
      updatedEvents = [...events, eventData]
    }
    setEvents(updatedEvents)

    // Save to API
    try {
      await fetch('/api/calendar/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: updatedEvents })
      })
    } catch (error) {
      console.error('Error saving event:', error)
    }

    setDialogOpen(false)
  }

  // Delete event
  const deleteEvent = async (eventId: string) => {
    const updatedEvents = events.filter(e => e.id !== eventId)
    setEvents(updatedEvents)

    try {
      await fetch('/api/calendar/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: updatedEvents })
      })
    } catch (error) {
      console.error('Error deleting event:', error)
    }
  }

  const colorOptions = [
    { value: '#3b82f6', label: 'Azul' },
    { value: '#10b981', label: 'Verde' },
    { value: '#f59e0b', label: 'Amarillo' },
    { value: '#ef4444', label: 'Rojo' },
    { value: '#8b5cf6', label: 'Púrpura' }
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {/* Header */}
      <header className="border-b bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                <CalendarDays className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">Calendario Colaborativo</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">Sincronización en tiempo real</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                En línea
              </Badge>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Calendar */}
          <div className="lg:col-span-1">
            <Card className="shadow-lg border-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Calendario</CardTitle>
                <CardDescription>Selecciona un día para ver eventos</CardDescription>
              </CardHeader>
              <CardContent>
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                  className="rounded-md border-0"
                  modifiers={{
                    hasEvent: events.map(e => new Date(e.date))
                  }}
                  modifiersStyles={{
                    hasEvent: { fontWeight: 'bold' }
                  }}
                  components={{
                    DayContent: (props) => {
                      const date = props.date
                      const colors = getEventColors(date)
                      const isToday = date.toDateString() === new Date().toDateString()
                      
                      return (
                        <div className="relative w-full h-full flex flex-col items-center justify-center">
                          <span className={isToday ? 'font-bold' : ''}>{date.getDate()}</span>
                          {colors.length > 0 && (
                            <div className="flex gap-0.5 mt-0.5">
                              {colors.slice(0, 3).map((color, i) => (
                                <span
                                  key={i}
                                  className="w-1.5 h-1.5 rounded-full"
                                  style={{ backgroundColor: color }}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    }
                  }}
                />
              </CardContent>
            </Card>

            {/* Instructions */}
            <Card className="mt-6 shadow-lg border-0 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/50 dark:to-indigo-950/50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Chrome className="w-5 h-5" />
                  Extensión de Chrome
                </CardTitle>
                <CardDescription>Instala la extensión para acceder rápidamente</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-blue-500 text-white text-sm flex items-center justify-center flex-shrink-0">1</div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">Descarga la carpeta <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">chrome-extension</code></p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-blue-500 text-white text-sm flex items-center justify-center flex-shrink-0">2</div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">Abre <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">chrome://extensions</code></p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-blue-500 text-white text-sm flex items-center justify-center flex-shrink-0">3</div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">Activa "Modo desarrollador" y haz clic en "Cargar descomprimida"</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-blue-500 text-white text-sm flex items-center justify-center flex-shrink-0">4</div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">Selecciona la carpeta de la extensión</p>
                </div>
                <Separator className="my-4" />
                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <Users className="w-4 h-4" />
                  <span>Todos los usuarios verán los mismos eventos</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Events Panel */}
          <div className="lg:col-span-2">
            <Card className="shadow-lg border-0 h-full">
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle className="text-lg">{formatSelectedDate()}</CardTitle>
                  <CardDescription>
                    {dayEvents.length} evento{dayEvents.length !== 1 ? 's' : ''} programado{dayEvents.length !== 1 ? 's' : ''}
                  </CardDescription>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <DialogTrigger asChild>
                    <Button onClick={openNewEventDialog}>
                      <Plus className="w-4 h-4 mr-2" />
                      Añadir Evento
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                      <DialogTitle>{editingEvent ? 'Editar Evento' : 'Nuevo Evento'}</DialogTitle>
                      <DialogDescription>
                        {formatSelectedDate()}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label htmlFor="title">Título</Label>
                        <Input
                          id="title"
                          placeholder="Nombre del evento..."
                          value={formData.title}
                          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="description">Descripción</Label>
                        <Textarea
                          id="description"
                          placeholder="Detalles adicionales..."
                          value={formData.description}
                          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="time">Hora</Label>
                        <Input
                          id="time"
                          type="time"
                          value={formData.time}
                          onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Color</Label>
                        <div className="flex gap-2">
                          {colorOptions.map((color) => (
                            <button
                              key={color.value}
                              className={`w-8 h-8 rounded-full transition-transform ${formData.color === color.value ? 'ring-2 ring-offset-2 ring-slate-400 scale-110' : ''}`}
                              style={{ backgroundColor: color.value }}
                              onClick={() => setFormData({ ...formData, color: color.value })}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                      <Button onClick={saveEvent} disabled={!formData.title.trim()}>Guardar</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px] pr-4">
                  {loading ? (
                    <div className="flex items-center justify-center h-32">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                    </div>
                  ) : dayEvents.length === 0 ? (
                    <div className="text-center py-12">
                      <CalendarDays className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
                      <p className="text-slate-500 dark:text-slate-400">No hay eventos para este día</p>
                      <Button variant="link" onClick={openNewEventDialog} className="mt-2">
                        Añadir el primer evento
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {dayEvents
                        .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
                        .map((event) => (
                          <div
                            key={event.id}
                            className="group p-4 rounded-lg border bg-white dark:bg-slate-800 hover:shadow-md transition-all"
                            style={{ borderLeftWidth: '4px', borderLeftColor: event.color }}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <h3 className="font-semibold text-slate-900 dark:text-white">{event.title}</h3>
                                {event.description && (
                                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{event.description}</p>
                                )}
                                {event.time && (
                                  <div className="flex items-center gap-1 mt-2 text-sm text-slate-500 dark:text-slate-400">
                                    <Clock className="w-3 h-3" />
                                    <span>{formatTime(event.time)}</span>
                                  </div>
                                )}
                              </div>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button variant="ghost" size="icon" onClick={() => openEditEventDialog(event)}>
                                  <Edit2 className="w-4 h-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => deleteEvent(event.id)} className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950">
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}

import { NextRequest, NextResponse } from 'next/server';
import { supabase, CalendarEvent, CalendarEventInsert } from '@/lib/supabase';

// GET - Fetch all events
export async function GET() {
  try {
    const { data: events, error } = await supabase
      .from('calendar_events')
      .select('*')
      .order('date', { ascending: true })
      .order('time', { ascending: true });

    if (error) {
      console.error('Error fetching events:', error);
      return NextResponse.json(
        { error: 'Error al obtener eventos' },
        { status: 500 }
      );
    }

    return NextResponse.json(events?.map((event: CalendarEvent) => ({
      id: event.id,
      title: event.title,
      description: event.description,
      date: event.date,
      time: event.time,
      color: event.color,
      createdAt: event.created_at,
      updatedAt: event.updated_at
    })) || []);
  } catch (error) {
    console.error('Error fetching events:', error);
    return NextResponse.json(
      { error: 'Error al obtener eventos' },
      { status: 500 }
    );
  }
}

// POST - Save all events (sync)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { events } = body;

    if (!Array.isArray(events)) {
      return NextResponse.json(
        { error: 'Formato de eventos inválido' },
        { status: 400 }
      );
    }

    // Get all existing events
    const { data: existingEvents, error: fetchError } = await supabase
      .from('calendar_events')
      .select('id');

    if (fetchError) {
      console.error('Error fetching existing events:', fetchError);
      return NextResponse.json(
        { error: 'Error al obtener eventos existentes' },
        { status: 500 }
      );
    }

    const existingIds = new Set(existingEvents?.map((e: { id: string }) => e.id) || []);
    const requestIds = new Set(events.map((e: { id: string }) => e.id));

    // Events to create
    const toCreate: CalendarEventInsert[] = events
      .filter((event: any) => !existingIds.has(event.id))
      .map((event: any) => ({
        id: event.id,
        title: event.title,
        description: event.description || null,
        date: event.date,
        time: event.time || null,
        color: event.color || '#3b82f6'
      }));

    // Events to update
    const toUpdate = events.filter((event: any) => existingIds.has(event.id));

    // Events to delete
    const toDelete = Array.from(existingIds).filter(id => !requestIds.has(id));

    // Delete removed events
    if (toDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from('calendar_events')
        .delete()
        .in('id', toDelete);

      if (deleteError) {
        console.error('Error deleting events:', deleteError);
        return NextResponse.json(
          { error: 'Error al eliminar eventos' },
          { status: 500 }
        );
      }
    }

    // Create new events
    if (toCreate.length > 0) {
      const { error: insertError } = await supabase
        .from('calendar_events')
        .insert(toCreate);

      if (insertError) {
        console.error('Error creating events:', insertError);
        return NextResponse.json(
          { error: 'Error al crear eventos' },
          { status: 500 }
        );
      }
    }

    // Update existing events
    for (const event of toUpdate) {
      const { error: updateError } = await supabase
        .from('calendar_events')
        .update({
          title: event.title,
          description: event.description || null,
          date: event.date,
          time: event.time || null,
          color: event.color
        })
        .eq('id', event.id);

      if (updateError) {
        console.error('Error updating event:', updateError);
      }
    }

    // Return updated events
    const { data: updatedEvents, error: finalFetchError } = await supabase
      .from('calendar_events')
      .select('*')
      .order('date', { ascending: true })
      .order('time', { ascending: true });

    if (finalFetchError) {
      console.error('Error fetching updated events:', finalFetchError);
      return NextResponse.json(
        { error: 'Error al obtener eventos actualizados' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Eventos sincronizados correctamente',
      events: updatedEvents?.map((event: CalendarEvent) => ({
        id: event.id,
        title: event.title,
        description: event.description,
        date: event.date,
        time: event.time,
        color: event.color,
        createdAt: event.created_at,
        updatedAt: event.updated_at
      })) || []
    });
  } catch (error) {
    console.error('Error saving events:', error);
    return NextResponse.json(
      { error: 'Error al guardar eventos' },
      { status: 500 }
    );
  }
}

// DELETE - Delete a single event
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'ID de evento requerido' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('calendar_events')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting event:', error);
      return NextResponse.json(
        { error: 'Error al eliminar evento' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: 'Evento eliminado' });
  } catch (error) {
    console.error('Error deleting event:', error);
    return NextResponse.json(
      { error: 'Error al eliminar evento' },
      { status: 500 }
    );
  }
}

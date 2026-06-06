const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
  cors: { origin: "*" } 
});

// ✅ SERVIR ARCHIVOS ESTÁTICOS (la carpeta "public")
app.use(express.static('public'));
app.use(cors());

// ✅ RUTA PARA EL CELULAR - ¡ESTA ES LA QUE FALTABA!
app.get('/control/:salaId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'control.html'));
});

// ✅ RUTA PARA LA PANTALLA DEL JUEGO
app.get('/sala/:salaId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== BASE DE DATOS DE PREGUNTAS ==========
const preguntas = [
  {
    id: "P001",
    pregunta: "Menciona algo que haces cuando tienes hambre",
    respuestas: [
      { texto: "Comer", puntos: 45, orden: 1 },
      { texto: "Buscar comida", puntos: 25, orden: 2 },
      { texto: "Refrigerador", puntos: 15, orden: 3 },
      { texto: "Pedir delivery", puntos: 10, orden: 4 },
      { texto: "Quejarse", puntos: 5, orden: 5 }
    ]
  },
  {
    id: "P002",
    pregunta: "¿Qué le pides prestado a tu vecino?",
    respuestas: [
      { texto: "Azúcar", puntos: 40, orden: 1 },
      { texto: "Sal", puntos: 25, orden: 2 },
      { texto: "Herramientas", puntos: 20, orden: 3 },
      { texto: "Dinero", puntos: 10, orden: 4 },
      { texto: "WiFi", puntos: 5, orden: 5 }
    ]
  },
  {
    id: "P003",
    pregunta: "Menciona una excusa para llegar tarde al trabajo",
    respuestas: [
      { texto: "Tráfico", puntos: 50, orden: 1 },
      { texto: "Despertador", puntos: 25, orden: 2 },
      { texto: "Transporte", puntos: 15, orden: 3 },
      { texto: "Emergencia familiar", puntos: 7, orden: 4 },
      { texto: "Se me olvidó", puntos: 3, orden: 5 }
    ]
  },
  {
    id: "P004",
    pregunta: "Menciona algo que guardas en el refrigerador",
    respuestas: [
      { texto: "Leche", puntos: 42, orden: 1 },
      { texto: "Huevos", puntos: 28, orden: 2 },
      { texto: "Verduras", puntos: 15, orden: 3 },
      { texto: "Cerveza", puntos: 10, orden: 4 },
      { texto: "Sofrito", puntos: 5, orden: 5 }
    ]
  },
  {
    id: "P005",
    pregunta: "¿Qué hace tu mamá cuando te enoja?",
    respuestas: [
      { texto: "Te regaña", puntos: 48, orden: 1 },
      { texto: "Te mira feo", puntos: 25, orden: 2 },
      { texto: "Te ignora", puntos: 15, orden: 3 },
      { texto: "Llama a tu papá", puntos: 8, orden: 4 },
      { texto: "Te quita el celular", puntos: 4, orden: 5 }
    ]
  }
];

// ========== ESTADO DEL JUEGO ==========
const salas = {};

class SalaJuego {
  constructor(id) {
    this.id = id;
    this.equipos = { A: [], B: [] };
    this.preguntaActual = null;
    this.buzzersActivos = false;
    this.puntos = { A: 0, B: 0 };
    this.ronda = 1;
    this.strikes = 0;
    this.equipoJugando = null;
    this.respuestasReveladas = [];
    this.estado = 'esperando';
    this.presentador = null;
  }

  obtenerPreguntaAleatoria() {
    const disponibles = preguntas.filter(p => !this.preguntasUsadas || !this.preguntasUsadas.includes(p.id));
    if (!this.preguntasUsadas) this.preguntasUsadas = [];
    if (disponibles.length === 0) {
      this.preguntasUsadas = [];
      return preguntas[Math.floor(Math.random() * preguntas.length)];
    }
    const pregunta = disponibles[Math.floor(Math.random() * disponibles.length)];
    this.preguntasUsadas.push(pregunta.id);
    return pregunta;
  }

  activarBuzzers() {
    this.buzzersActivos = true;
    this.primerBuzz = null;
    io.to(this.id).emit('BUZZERS_ACTIVADOS');
  }

  procesarBuzz(jugadorId, timestamp) {
    if (!this.buzzersActivos || this.primerBuzz) return false;
    this.primerBuzz = { jugadorId, timestamp };
    this.buzzersActivos = false;
    const jugador = this.encontrarJugador(jugadorId);
    const equipo = jugador ? jugador.equipo : null;
    io.to(this.id).emit('GANADOR_BUZZ', { 
      jugadorId, 
      nombre: jugador ? jugador.nombre : 'Desconocido',
      equipo,
      tiempo: Date.now() - timestamp 
    });
    return true;
  }

  encontrarJugador(jugadorId) {
    for (let eq of ['A', 'B']) {
      const jugador = this.equipos[eq].find(j => j.id === jugadorId);
      if (jugador) return { ...jugador, equipo: eq };
    }
    return null;
  }

  validarRespuesta(textoRespuesta) {
    const pregunta = this.preguntaActual;
    if (!pregunta) return { correcta: false };
    const normalizada = this.normalizarTexto(textoRespuesta);
    for (let respuesta of pregunta.respuestas) {
      const similitud = this.calcularSimilitud(normalizada, this.normalizarTexto(respuesta.texto));
      if (similitud > 0.75) {
        return { correcta: true, respuesta: respuesta, esTop: respuesta.orden === 1 };
      }
    }
    return { correcta: false };
  }

  normalizarTexto(texto) {
    if (!texto) return '';
    return texto.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, "")
      .trim();
  }

  calcularSimilitud(str1, str2) {
    if (str1 === str2) return 1;
    if (str1.includes(str2) || str2.includes(str1)) return 0.9;
    const palabras1 = str1.split(' ');
    const palabras2 = str2.split(' ');
    const comunes = palabras1.filter(p => palabras2.includes(p));
    if (comunes.length > 0) return 0.85;
    return 0;
  }

  agregarStrike() {
    this.strikes++;
    io.to(this.id).emit('STRIKE', { strikes: this.strikes, equipo: this.equipoJugando });
    if (this.strikes >= 3) {
      this.estado = 'robo';
      const equipoOpuesto = this.equipoJugando === 'A' ? 'B' : 'A';
      io.to(this.id).emit('OPORTUNIDAD_ROBO', { equipoOpuesto, puntosEnJuego: this.calcularPuntosEnJuego() });
    }
  }

  calcularPuntosEnJuego() {
    if (!this.preguntaActual) return 0;
    let puntos = 0;
    for (let r of this.preguntaActual.respuestas) {
      if (this.respuestasReveladas.includes(r.texto)) puntos += r.puntos;
    }
    if (this.ronda === 4) puntos *= 2;
    if (this.ronda === 5) puntos *= 3;
    return puntos;
  }

  revelarRespuesta(respuesta) {
    this.respuestasReveladas.push(respuesta.texto);
    io.to(this.id).emit('RESPUESTA_REVELADA', { respuesta, puntosTotales: this.calcularPuntosEnJuego() });
  }

  sumarPuntos(equipo, puntos) {
    this.puntos[equipo] += puntos;
    io.to(this.id).emit('PUNTOS_ACTUALIZADOS', this.puntos);
  }
}

function generarCodigo() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ========== EVENTOS SOCKET.IO ==========
io.on('connection', (socket) => {
  console.log('Nuevo jugador conectado:', socket.id);

  socket.on('CREAR_SALA', () => {
    const salaId = generarCodigo();
    salas[salaId] = new SalaJuego(salaId);
    socket.join(salaId);
    socket.salaId = salaId;
    socket.esPresentador = true;
    salas[salaId].presentador = socket.id;
    
    const baseUrl = socket.handshake.headers.origin || `https://${socket.handshake.headers.host}`;
    socket.emit('SALA_CREADA', { 
      salaId,
      urlJuego: `${baseUrl}/sala/${salaId}`,
      urlControl: `${baseUrl}/control/${salaId}`
    });
    console.log(`✅ Sala creada: ${salaId}`);
  });

  socket.on('UNIRSE_SALA', ({ salaId, equipo, nombre }) => {
    const sala = salas[salaId];
    if (!sala) {
      socket.emit('ERROR', 'Sala no existe. Verifica el código.');
      return;
    }
    if (!nombre || nombre.trim().length < 2) {
      socket.emit('ERROR', 'Por favor ingresa un nombre válido');
      return;
    }
    if (!['A', 'B'].includes(equipo)) {
      socket.emit('ERROR', 'Equipo debe ser A o B');
      return;
    }

    socket.join(salaId);
    socket.salaId = salaId;
    socket.jugadorId = socket.id;
    socket.nombre = nombre.trim();
    socket.equipo = equipo;
    
    sala.equipos[equipo].push({ id: socket.id, nombre: nombre.trim(), conectado: true });
    
    socket.emit('UNIDO_EXITOSO', { 
      salaId, 
      equipo, 
      nombre: nombre.trim(),
      jugadoresEnEquipo: sala.equipos[equipo].length 
    });
    
    io.to(salaId).emit('JUGADOR_UNIDO', { 
      nombre: nombre.trim(), 
      equipo, 
      totalA: sala.equipos.A.length,
      totalB: sala.equipos.B.length
    });
    console.log(`👤 ${nombre.trim()} se unió al equipo ${equipo} en sala ${salaId}`);
  });

  socket.on('INICIAR_JUEGO', () => {
    const sala = salas[socket.salaId];
    if (!sala || !socket.esPresentador) return;
    sala.estado = 'jugando';
    sala.ronda = 1;
    io.to(sala.id).emit('JUEGO_INICIADO', { ronda: 1 });
  });

  socket.on('NUEVA_PREGUNTA', () => {
    const sala = salas[socket.salaId];
    if (!sala || !socket.esPresentador) return;
    const pregunta = sala.obtenerPreguntaAleatoria();
    if (!pregunta) {
      socket.emit('ERROR', 'No hay más preguntas disponibles');
      return;
    }
    sala.preguntaActual = pregunta;
    sala.strikes = 0;
    sala.equipoJugando = null;
    sala.respuestasReveladas = [];
    sala.estado = 'preguntando';
    io.to(sala.id).emit('NUEVA_PREGUNTA', {
      pregunta: pregunta.pregunta,
      numRespuestas: pregunta.respuestas.length,
      ronda: sala.ronda
    });
  });

  socket.on('ACTIVAR_BUZZERS', () => {
    const sala = salas[socket.salaId];
    if (!sala || !socket.esPresentador) return;
    sala.activarBuzzers();
  });

  socket.on('BUZZER_PRESSED', () => {
    const sala = salas[socket.salaId];
    if (!sala) return;
    sala.procesarBuzz(socket.jugadorId || socket.id, Date.now());
  });

  socket.on('RESPUESTA_JUGADOR', ({ respuesta }) => {
    const sala = salas[socket.salaId];
    if (!sala || !respuesta) return;
    const resultado = sala.validarRespuesta(respuesta);
    const jugador = sala.encontrarJugador(socket.jugadorId || socket.id);
    const equipo = jugador ? jugador.equipo : null;
    
    if (resultado.correcta) {
      if (resultado.esTop && !sala.equipoJugando) {
        sala.equipoJugando = equipo;
        io.to(sala.id).emit('RESPUESTA_TOP', {
          respuesta: resultado.respuesta,
          jugador: socket.nombre || 'Jugador',
          equipo,
          mensaje: `${socket.nombre || 'Jugador'} acertó la respuesta #1: "${resultado.respuesta.texto}"`
        });
      } else if (sala.equipoJugando === equipo) {
        sala.revelarRespuesta(resultado.respuesta);
        const todasReveladas = sala.preguntaActual.respuestas.every(r => sala.respuestasReveladas.includes(r.texto));
        if (todasReveladas) {
          const puntos = sala.calcularPuntosEnJuego();
          sala.sumarPuntos(equipo, puntos);
          sala.estado = 'esperando';
          io.to(sala.id).emit('RONDA_TERMINADA', { equipo, puntos, mensaje: `¡Equipo ${equipo} se lleva ${puntos} puntos!` });
        }
      } else {
        sala.revelarRespuesta(resultado.respuesta);
        const puntos = sala.calcularPuntosEnJuego();
        sala.sumarPuntos(equipo, puntos);
        sala.estado = 'esperando';
        io.to(sala.id).emit('ROBO_EXITOSO', { equipo, puntos });
      }
    } else {
      if (sala.equipoJugando === equipo) {
        sala.agregarStrike();
        if (sala.strikes >= 3) {
          const otroEquipo = equipo === 'A' ? 'B' : 'A';
          io.to(sala.id).emit('ROBO_DISPONIBLE', { equipo: otroEquipo });
        }
      }
    }
  });

  socket.on('ELEGIR_JUGAR', ({ jugar }) => {
    const sala = salas[socket.salaId];
    if (!sala) return;
    if (jugar) {
      io.to(sala.id).emit('TURNO_ASIGNADO', { equipo: sala.equipoJugando, mensaje: `Equipo ${sala.equipoJugando} juega` });
    } else {
      const otroEquipo = sala.equipoJugando === 'A' ? 'B' : 'A';
      sala.equipoJugando = otroEquipo;
      io.to(sala.id).emit('TURNO_PASADO', { equipo: otroEquipo, mensaje: `Equipo ${otroEquipo} juega` });
    }
  });

  socket.on('INTENTAR_ROBO', ({ respuesta }) => {
    const sala = salas[socket.salaId];
    if (!sala || sala.estado !== 'robo') return;
    const jugador = sala.encontrarJugador(socket.jugadorId || socket.id);
    const equipo = jugador ? jugador.equipo : null;
    const equipoOpuesto = sala.equipoJugando === 'A' ? 'B' : 'A';
    if (equipo !== equipoOpuesto) {
      socket.emit('ERROR', 'No es tu turno para robar');
      return;
    }
    const resultado = sala.validarRespuesta(respuesta);
    if (resultado.correcta && !sala.respuestasReveladas.includes(resultado.respuesta.texto)) {
      const puntos = sala.calcularPuntosEnJuego();
      sala.sumarPuntos(equipo, puntos);
      sala.estado = 'esperando';
      io.to(sala.id).emit('ROBO_EXITOSO', { equipo, puntos });
    } else {
      const puntos = sala.calcularPuntosEnJuego();
      sala.sumarPuntos(sala.equipoJugando, puntos);
      sala.estado = 'esperando';
      io.to(sala.id).emit('ROBO_FALLIDO', { equipo: sala.equipoJugando, puntos });
    }
  });

  socket.on('SIGUIENTE_RONDA', () => {
    const sala = salas[socket.salaId];
    if (!sala || !socket.esPresentador) return;
    sala.ronda++;
    if (sala.ronda > 5) {
      const ganador = sala.puntos.A > sala.puntos.B ? 'A' : (sala.puntos.B > sala.puntos.A ? 'B' : 'EMPATE');
      io.to(sala.id).emit('JUEGO_TERMINADO', { puntos: sala.puntos, ganador, mensaje: ganador === 'EMPATE' ? '¡EMPATE!' : `¡Equipo ${ganador} GANA!` });
      return;
    }
    const multiplicador = sala.ronda === 4 ? 2 : (sala.ronda === 5 ? 3 : 1);
    io.to(sala.id).emit('NUEVA_RONDA', { ronda: sala.ronda, multiplicador, puntosActuales: sala.puntos });
  });

  socket.on('INICIAR_DINERO_RAPIDO', () => {
    const sala = salas[socket.salaId];
    if (!sala || !socket.esPresentador) return;
    const jugadores = [...sala.equipos.A, ...sala.equipos.B];
    if (jugadores.length === 0) {
      socket.emit('ERROR', 'No hay jugadores para Dinero Rápido');
      return;
    }
    const jugador = jugadores[Math.floor(Math.random() * jugadores.length)];
    sala.estado = 'dinero_rapido';
    io.to(sala.id).emit('INICIO_DINERO_RAPIDO', {
      jugador: jugador.nombre,
      tiempoPorPregunta: 20,
      preguntas: preguntas.slice(0, 5).map(p => ({ pregunta: p.pregunta, id: p.id }))
    });
  });

  socket.on('disconnect', () => {
    console.log('Jugador desconectado:', socket.id);
    const sala = salas[socket.salaId];
    if (sala) {
      for (let eq of ['A', 'B']) {
        sala.equipos[eq] = sala.equipos[eq].filter(j => j.id !== socket.id);
      }
      io.to(sala.id).emit('JUGADOR_DESCONECTADO', { id: socket.id });
    }
  });
});

// ========== INICIAR SERVIDOR ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 100 LATINOS DIJERON corriendo en puerto ${PORT}`);
});

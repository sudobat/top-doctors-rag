-- Se ejecuta solo al crear el volumen: extensión pgvector y base de datos para los tests.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE DATABASE rag_test;
\c rag_test
CREATE EXTENSION IF NOT EXISTS vector;

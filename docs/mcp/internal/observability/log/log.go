package log

import (
	"context"
	"os"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

type Field = zap.Field

type Logger struct {
	*zap.Logger
}

func New(level string) *Logger {
	parsed, err := zapcore.ParseLevel(level)
	if err != nil {
		parsed = zapcore.InfoLevel
	}

	var config zap.Config
	if os.Getenv("APP_ENV") == "production" {
		config = zap.NewProductionConfig()
	} else {
		config = zap.NewDevelopmentConfig()
	}

	config.Level = zap.NewAtomicLevelAt(parsed)
	config.EncoderConfig.TimeKey = "timestamp"
	config.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder

	logger, _ := config.Build()
	return &Logger{logger}
}

func (l *Logger) WithContext(_ context.Context) *Logger {
	return l
}

func (l *Logger) Debug(msg string, fields ...Field) {
	l.Logger.Debug(msg, fields...)
}

func (l *Logger) Info(msg string, fields ...Field) {
	l.Logger.Info(msg, fields...)
}

func (l *Logger) Warn(msg string, fields ...Field) {
	l.Logger.Warn(msg, fields...)
}

func (l *Logger) Error(msg string, fields ...Field) {
	l.Logger.Error(msg, fields...)
}

func (l *Logger) Fatal(msg string, fields ...Field) {
	l.Logger.Fatal(msg, fields...)
}

// Field aliases for convenience
var (
	String = zap.String
	Int    = zap.Int
	Int64  = zap.Int64
	Bool   = zap.Bool
	Error  = zap.Error
)

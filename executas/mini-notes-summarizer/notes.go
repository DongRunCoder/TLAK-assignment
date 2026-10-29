package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

// jsWhitespace exactly matches ECMAScript String.prototype.trim's code points.
func jsWhitespace(r rune) bool {
	return r >= '\u0009' && r <= '\u000d' || r == '\u0020' || r == '\u00a0' || r == '\u1680' ||
		r >= '\u2000' && r <= '\u200a' || r == '\u2028' || r == '\u2029' || r == '\u202f' || r == '\u205f' || r == '\u3000' || r == '\ufeff'
}

// encoding/json replaces invalid UTF-8 and unpaired surrogate escapes. Reject
// those before decoding so the prompt never silently changes input characters.
func validUnicodeJSON(raw []byte) bool {
	if !utf8.Valid(raw) {
		return false
	}
	var high bool
	for i := 0; i < len(raw); i++ {
		if raw[i] != '\\' {
			if high {
				return false
			}
			continue
		}
		i++
		if i >= len(raw) {
			return false
		}
		if raw[i] != 'u' {
			if high {
				return false
			}
			continue
		}
		if i+4 >= len(raw) {
			return false
		}
		var value uint16
		for j := 1; j <= 4; j++ {
			c := raw[i+j]
			value <<= 4
			switch {
			case c >= '0' && c <= '9':
				value += uint16(c - '0')
			case c >= 'a' && c <= 'f':
				value += uint16(c - 'a' + 10)
			case c >= 'A' && c <= 'F':
				value += uint16(c - 'A' + 10)
			default:
				return false
			}
		}
		i += 4
		if high {
			if value < 0xdc00 || value > 0xdfff {
				return false
			}
			high = false
		} else if value >= 0xd800 && value <= 0xdbff {
			high = true
		} else if value >= 0xdc00 && value <= 0xdfff {
			return false
		}
	}
	return !high
}

func validateNotes(raw json.RawMessage) ([]string, error) {
	if !validUnicodeJSON(raw) {
		return nil, errors.New("notes must contain valid Unicode scalar values")
	}
	var notes []string
	if err := json.Unmarshal(raw, &notes); err != nil || notes == nil || len(notes) == 0 {
		return nil, errors.New("notes must be a non-empty string array")
	}
	if len(notes) > 100 {
		return nil, errors.New("notes cannot exceed 100 items")
	}
	total := 0
	for index, note := range notes {
		if strings.TrimFunc(note, jsWhitespace) == "" {
			return nil, fmt.Errorf("note %d must not be blank", index+1)
		}
		if utf8.RuneCountInString(note) > 1000 {
			return nil, fmt.Errorf("note %d exceeds 1000 Unicode code points", index+1)
		}
		total += len(note)
	}
	if total > 24576 {
		return nil, errors.New("notes body exceeds 24576 UTF-8 bytes")
	}
	return notes, nil
}

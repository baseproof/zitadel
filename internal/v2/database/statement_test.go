package database

import (
	"io"
	"reflect"
	"testing"
)

func TestStatement_WriteByte(t *testing.T) {
	var stmt Statement
	var writer io.ByteWriter = &stmt
	for _, b := range []byte("SELECT $1") {
		if err := writer.WriteByte(b); err != nil {
			t.Fatal(err)
		}
	}
	assertQuery(t, &stmt, wantQuery{query: "SELECT $1"})
}

func TestStatement_CopyAfterAppendPanics(t *testing.T) {
	var stmt Statement
	stmt.AppendArg("original")
	copied := stmt
	defer func() {
		if got := recover(); got != "statement: illegal use of non-zero Builder copied by value" {
			t.Errorf("unexpected panic: %v", got)
		}
	}()
	copied.AppendArg("copy")
}

func TestStatement_ResetAllowsReuse(t *testing.T) {
	var stmt Statement
	stmt.WriteArgs("old")
	stmt.Reset()
	assertQuery(t, &stmt, wantQuery{})

	copied := stmt
	copied.WriteArgs("new")
	assertQuery(t, &copied, wantQuery{query: "$1", args: []any{"new"}})
	assertQuery(t, &stmt, wantQuery{})
}

func TestStatement_WriteArgs(t *testing.T) {
	type args struct {
		args []any
	}
	tests := []struct {
		name string
		args args
		want wantQuery
	}{
		{
			name: "no args",
			args: args{
				args: nil,
			},
		},
		{
			name: "1 arg",
			args: args{
				args: []any{"asdf"},
			},
			want: wantQuery{
				query: "$1",
				args:  []any{"asdf"},
			},
		},
		{
			name: "n args",
			args: args{
				args: []any{"asdf", "jkl", 1},
			},
			want: wantQuery{
				query: "$1, $2, $3",
				args:  []any{"asdf", "jkl", 1},
			},
		},
	}
	for _, tt := range tests {
		var stmt Statement
		t.Run(tt.name, func(t *testing.T) {
			stmt.WriteArgs(tt.args.args...)
			assertQuery(t, &stmt, tt.want)
		})
	}
}

type wantQuery struct {
	query string
	args  []any
}

func assertQuery(t *testing.T, stmt *Statement, want wantQuery) {
	if want.query != stmt.String() {
		t.Errorf("unexpected query: want: %q got: %q", want.query, stmt.String())
	}

	if len(want.args) != len(stmt.Args()) {
		t.Errorf("unexpected length of args: want %d, got %d", len(want.args), len(stmt.Args()))
		return
	}

	for i, wantArg := range want.args {
		if !reflect.DeepEqual(wantArg, stmt.Args()[i]) {
			t.Errorf("unexpected arg at position %d: want: %v, got: %v", i, wantArg, stmt.Args()[i])
		}
	}
}

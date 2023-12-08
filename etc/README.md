```
$ openssl version
OpenSSL 3.0.2 15 Mar 2022 (Library: OpenSSL 3.0.2 15 Mar 2022)
```

```
openssl enc -d -aes-256-cbc -salt -pbkdf2 -in github-recovery-codes.openssl-enc-aes-256-cbc-salt-pbkdf2-password.enc -out github-recovery-codes.txt
```

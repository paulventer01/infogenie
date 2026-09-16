FROM postgres:16-bookworm
RUN openssl req -new -x509 -nodes -days 3650 -subj /CN=localhost \
    -keyout /var/lib/postgresql/preview.key -out /var/lib/postgresql/preview.crt \
    && chown postgres:postgres /var/lib/postgresql/preview.key /var/lib/postgresql/preview.crt \
    && chmod 600 /var/lib/postgresql/preview.key
CMD ["postgres", "-c", "ssl=on", "-c", "ssl_cert_file=/var/lib/postgresql/preview.crt", "-c", "ssl_key_file=/var/lib/postgresql/preview.key"]

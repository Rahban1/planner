# Enterprise certificate authorities

Put approved company certificate authority files in this directory before you build the runner images. Use the `.crt` file extension and PEM encoding.

Git ignores the certificate files. The Docker build adds them to the trust store in both images. Do not add private keys to this directory.

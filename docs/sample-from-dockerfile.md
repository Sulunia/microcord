# Install latest imagemagick, for **much** better AVIF support
RUN mkdir /extras
WORKDIR /extras
RUN wget https://github.com/ImageMagick/ImageMagick/archive/refs/tags/7.1.2-19.tar.gz
RUN gunzip 7.1.2-19.tar.gz
RUN tar xf 7.1.2-19.tar
RUN rm 7.1.2-19.tar
WORKDIR ImageMagick-7.1.2-19
RUN ./configure --with-xml=yes
RUN make
RUN make install
RUN ldconfig /usr/local/lib
RUN /usr/local/bin/convert logo: logo.avif